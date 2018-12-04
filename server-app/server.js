let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io');

const aws = require('aws-sdk');

const { timer, Observable, Subscription, of, from, fromEvent, interval, Subject } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, first, mapTo, tap, switchMap, merge, mergeMap, filter, take, takeUntil,
        catchError, concat, flatMap, multicast, refCount, share } = require('rxjs/operators');


let MessageRef = function(type, message) {
    return {
        type: type,
        datetime: new Date().toISOString(),
        text: message
    };
};

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
    let put_params = {
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
    docClient.put(put_params, function(err, data) {
        if (err)
            console.log('Error inserting data', JSON.stringify(err, null, 2));
        else {
            console.log('inserted', data);
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
const io$ = of(io(http));

const connection$ = io$.pipe(
    switchMap( io => fromEvent(io, 'connection').pipe(
        map(client => ({io, client}))
    ))
);
const disconnect$ = connection$.pipe(
    mergeMap( ({client}) => fromEvent(client, 'disconnect').pipe(
        map(() => client)
    ))
);

connection$.subscribe( ({io, client}) => {
    console.log('client connected', client.id);
    io.emit('message',  new MessageRef('message', 'user joined'));

    //==============================================================================================================
    // ClIENT Disconnect
    //==============================================================================================================
    const disconnect$ = fromEvent(client, 'disconnect').pipe(first());
    disconnect$.subscribe(() => console.log('user left'));

    //==============================================================================================================
    // CLIENT sent messages
    //==============================================================================================================
    // subscribe to client-messages. client -> server
    // then re-emit the same message. server -> all clients
    const adminMessages$ = fromEvent(client, 'admin-message').pipe(takeUntil(disconnect$));

    adminMessages$.subscribe(adminMessage => {
        console.log('admin-message', adminMessage, 'socket id', client.id);
        // do stuff with message
        // in this case we resend to all clients
        // TODO:
        //  1) validate the message - parse out all code or make trusted... based on our policy
        //  2) all business logic should go here to determine if a message should be broadcasted
        //  3) save the admin message into the database so new clients can get the message

        // save to the database
        let newDate = new Date();
        let dateString = newDate.toISOString();
        let endDate = new Date();
        endDate.setDate(newDate.getDate() + 1);
        let newDBMessage = {
            "id": newDate.getTime(),
            "audience": null,
            "visibility": "yes",
            "startDate": dateString,
            "endDate": endDate.toISOString(),
            "message": adminMessage
        };

        audienceKeys.forEach(function(key) {
            try {
                if(key) {
                    newDBMessage.audience = key;
                    console.log('db message', JSON.stringify(newDBMessage, null, 2));
                    putMessageForAudience(newDBMessage);
                }
            }
            catch(err) {
                console.log('caught error', JSON.stringify(err, null, 2));
            }
        });

        let newMessage = new MessageRef('admin-message', newDBMessage.message);

        // broadcast the message
        io.emit('message', newMessage);
    });

    //==============================================================================================================
    // SERVER sent messages (from database where the current date is within the range of the startDate and endDate of the message)
    //==============================================================================================================

    // the audience should come from somewhere... idk where yet though
    let targetAudience = 'test1';
    getCurrentMessagesForAudience(targetAudience)
    .then(function(data) {
        if(data && data.Items) {
            console.log(`query returned ${data.Items.length} results`);
            // emit the database messages to all clients
            data.Items.forEach(function(r) {
                client.emit('message', new MessageRef('db-message', r.message));
            });
        }
    })
    .catch(function(err) {
        console.log('error calling database', err);
    });
});

disconnect$.subscribe( client => {
    console.log('client disconnected');
    client.emit('message',  new MessageRef('message', 'user left'));
});

//#endregion

http.listen(4000, () => {
    console.log('server listening on port 4000');
});



