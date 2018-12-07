const express = require('express');
const app = express();
const https = require('https')
//let http = require('http').Server(app);
const io = require('socket.io');
const path = require('path');
const aws = require('aws-sdk');
const fs = require('fs');
//const debug = require('debug')(https);

const { timer, Observable, Subscription, of, from, fromEvent, interval, Subject } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, first, mapTo, tap, switchMap, merge, mergeMap, filter, take, takeUntil,
        catchError, concat, flatMap, multicast, refCount, share } = require('rxjs/operators');

//#region Https Server Setup
app.use(express.static("public"));
app.use(express.static("rxjs-tests"));

const appOptions = {
    key: fs.readFileSync('certs/server.key'),
    cert: fs.readFileSync('certs/server.crt')
};

const server = https.createServer(appOptions, app);
server.listen(4433, () => {
    console.log('server started and listening...');
});

//#region Https Server Routing
app.get('/', (req, res) => {
    console.log('/rxjs-tests/index.html');
    res.sendFile('/rxjs-tests/index.html');
});
//#endregion

//#endregion

//#region Data Models
let ClientRef = function(id, appId, nickname) {
    return {
        id: id,
        appId: appId,
        nickname: nickname,
        connectionTime: new Date().toISOString()
    };
};

let MessageRef = function(type, appId, message) {
    return {
        type: type,
        appId: appId,
        datetime: new Date().toISOString(),
        text: message
    };
};
//#endregion

//#region dynamodb
const config = {
    "apiVersion": "2012-08-10",
    "accessKeyid": "abcde",
    "secretAccessKey": "abcde",
    "region": "us-east-1",
    "endpoint": "http://localhost:8000"
};

const dynamodb = new aws.DynamoDB(config);
const docClient = new aws.DynamoDB.DocumentClient(config);

let audienceKeys = ["test1", "test2", "test3"];

let putMessageForAudience = function(row) {
    let params = {
        "TableName": "Messages",
        "Item": {
            "id": row.id,
            "audience": row.audience,
            "visibility": (row.visibility) ? row.visibility : "yes",
            "startDate": row.startDate,
            "endDate": row.endDate,
            "message": row.message
        }
    };
    docClient.put(params, function(err, data) {
        if (err)
            console.log(`db message insert error for {${params.Item.id} ${params.Item.audience}`, JSON.stringify(err, null, 2));
        else {
            console.log('db message insert', JSON.stringify(params.Item, null, 2));
        }
    });
};

let getCurrentMessagesForAudience = function(audience) {
    var params = {
        TableName: 'Messages',
        KeyConditionExpression: '#a = :v',
        FilterExpression: ':t >= #sd and :t < #ed',
        ExpressionAttributeNames: {
            '#a': 'audience',
            '#sd': 'startDate',
            '#ed': 'endDate',
        },
        ExpressionAttributeValues: {
          ':v': audience,
          ':t': new Date().toISOString()
        }
    };
    return docClient.query(params).promise();
}
//#endregion

//#region RXJS IO Wrapper
let connectedClients = {};

const io$ = of(io(server, {
    origins: 'localhost:*',
    autoConnect: false, 
    forceNew: false,
    pingInterval: 10000,
    transports: ['websocket', 'polling']
}));

const connection$ = io$.pipe(
    switchMap( io => fromEvent(io, 'connection').pipe(
        map( client => ({io, client}) )
    ))
);
const disconnect$ = connection$.pipe(
    mergeMap( ({client}) => fromEvent(client, 'disconnect').pipe(
        map( () => client )
    ))
);

connection$.subscribe( ({io, client}) => {
    console.log(`${client.id} connected`);

    let newClient = new ClientRef(client.id);
    connectedClients[client.id] = newClient;
    //io.emit('message',  new MessageRef('message', `user joined: ${client.id}`));

    //==============================================================================================================
    // CLIENT Disconnect
    //==============================================================================================================
    const disconnect$ = fromEvent(client, 'disconnect').pipe(first());
    disconnect$.subscribe(() => {
        if(connectedClients[client.id]) {

            let msg = { 
                total: Object.keys(connectedClients).length,
                client: connectedClients[client.id]
            };

            let newMessage = new MessageRef('admin-disconnect-report', 'Admin Disconnect Report', msg);
            io.emit(`admin-disconnect-report`, newMessage);

            console.log(`${JSON.stringify(connectedClients[client.id])} disconnected`);
            delete connectedClients[client.id];
            console.log('total clients', Object.keys(connectedClients).length)
        }
        else {
            console.log('***** WARNING ***** Client does not exist', client.id);
        }
    });

    //==============================================================================================================
    // CLIENT JOIN
    //==============================================================================================================
    fromEvent(client, 'join')
        .pipe(takeUntil(disconnect$))
        .subscribe(nameAppId => {
            if(!connectedClients[client.id]) {
                console.log('***** WARNING ***** We should not get here! Non-existing connected client', client.id);
                return;
            }

            connectedClients[client.id].nickname = nameAppId.name;
            connectedClients[client.id].appId = nameAppId.appId;
            console.log('joined', JSON.stringify(connectedClients[client.id]));
            console.log('total clients', Object.keys(connectedClients).length)
            
            let msg = { 
                total: Object.keys(connectedClients).length,
                client: connectedClients[client.id]
            };

            let newMessage = new MessageRef('admin-connect-report', 'Admin Connect Report', msg);
            io.emit('admin-connect-report', newMessage);

            //==============================================================================================================
            // SERVER sent messages (from database where the current date is within the range of the startDate and endDate of the message)
            //==============================================================================================================
            // the audience should come from somewhere... idk where yet though
            //console.log('getCurrentMessages', connectedClients[client.id]);
            getCurrentMessagesForAudience(connectedClients[client.id].appId)
            .then(function(data) {
                if(data && data.Items) {
                    console.log(`${JSON.stringify(connectedClients[client.id])} db query returned ${data.Items.length} results`);
                    data.Items.forEach(function(item) {
                        if(connectedClients[client.id] && connectedClients[client.id].appId)
                            client.emit(`${connectedClients[client.id].appId}-message`, new MessageRef('db-message', connectedClients[client.id].appId, item.message));
                    });
                }
            })
            .catch(function(err) {
                console.log(`${client.id} error calling database`, err);
            });            
        });

    //==============================================================================================================
    // CLIENT admin-get-clients
    // These are people trying to buck the system
    //==============================================================================================================
    fromEvent(client, 'admin-get-clients')
        .pipe(takeUntil(disconnect$))
        .subscribe( () => {
            let msg = { 
                total: Object.keys(connectedClients).length,
                clients: Object.values(connectedClients)
            };

            let newMessage = new MessageRef('admin-get-clients', 'Admin Clients Report', msg);
            io.emit('admin-get-clients', newMessage);
        });

    //==============================================================================================================
    // CLIENT appId-message
    // These are people trying to buck the system
    //==============================================================================================================
    fromEvent(client, `test3-message`)
        .pipe(takeUntil(disconnect$))
        .subscribe(clientMessage => {
            // log the message along with the client id...
            // then track them down and put send them to Gitmo
            console.log(`***** ILLEGAL OPERATION ****** user[${connectedClients[client.id].nickname}|${connectedClients[client.id].appId}|${connectedClients[client.id].id}] is trying to buck the system`);
        });

    //==============================================================================================================
    // CLIENT admin-message
    //==============================================================================================================
    // subscribe to client-messages. client -> server
    // then re-emit the same message. server -> all clients
    // ******** NOTE ********
    // WE NEED TO AUTHENTICATE THIS USERS... SO THEY CANNOT BROADCAST MESSAGES ALL WILLY NILLY
    fromEvent(client, 'admin-message')
        .pipe(takeUntil(disconnect$))
        .subscribe(adminMessage => {
            //console.log('admin-message', adminMessage, 'socket id', client.id);
            // do stuff with message
            // in this case we resend to all clients
            // TODO:
            //  1) validate the message - parse out all code or make trusted... based on our policy
            //  2) all business logic should go here to determine if a message should be broadcasted
            //  3) save the admin message into the database so new clients can get the message

            var app = adminMessage.appId;
            var message = adminMessage.message;

            // save to the database
            let newDate = new Date();
            let dateString = newDate.toISOString();
            let endDate = new Date();
            endDate.setDate(newDate.getDate() + 1);
            let newDBMessage = {
                "id": newDate.getTime(),
                "audience": app,
                "visibility": "yes",
                "startDate": dateString,
                "endDate": endDate.toISOString(),
                "message": message
            };

            console.log('admin-message', connectedClients[client.id].id, connectedClients[client.id].nickname, connectedClients[client.id].appId);
            if(app) {
                putMessageForAudience(newDBMessage);
                let newMessage = new MessageRef('admin-message', app, newDBMessage.message);
                io.emit(`${app}-message`, newMessage);
            }
            else {
                audienceKeys.forEach(function(key) {
                    if(key) {
                        //newDBMessage.id = `${key}-${newDate.getTime()}`;
                        newDBMessage.audience = key;
                        putMessageForAudience(newDBMessage);

                        let newMessage = new MessageRef('admin-message', 'global', newDBMessage.message);
                        io.emit(`${key}-message`, newMessage);
                    }
                });
            }
        });
});

//#endregion


