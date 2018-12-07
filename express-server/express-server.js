let app = require('express')();
let https = require('https')
let io = require('socket.io');

const aws = require('aws-sdk');

const { timer, Observable, Subscription, of, from, fromEvent, interval, Subject } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, first, mapTo, tap, switchMap, merge, mergeMap, filter, take, takeUntil,
        catchError, concat, flatMap, multicast, refCount, share } = require('rxjs/operators');


//#region Event Data Models
let ClientMessageRef = function(type, appId, message) {
    return {
        type: type,
        appId: appId,
        datetime: new Date().toISOString(),
        text: message
    };
};

let AdminMessageRef = function(type, message) {
    return {
        type: type,
        appId: 'admin',
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

// config should load this
const MessagesTableName = 'USA-E-UXD-Messages';
const UsersTableName = 'USA-E-UXD-Users';
const ItemStatus = {
    Pending: 'Pending',
    Approved: 'Approved',
    Deleted: 'Deleted'
};

const dynamodb = new aws.DynamoDB(config);
const docClient = new aws.DynamoDB.DocumentClient(config);

// appId's - this needs to come from a REST endpoint or JSON file.
let appIdKeys = ["test1", "test2", "test3"];

//#region US-E-UXD-Message Table

//#region Message Schema
/*
    US-E-UXD-Messages Schema
    {
        id          - 'appId-startDate'
        appId       - application id from CDN/Ecobar
        status      - Pending|Approved|Deleted
        startDate   - the start date of the message
        endDate     - the end date of the message
        message     - the actual message
        createdBy   - who created the message
        createdDate - the date the message was created
        modified[]  - a list of modified by and date { 'modifiedBy': '', 'modifiedDate': '' }
    }
*/
//#endregion

//#region Message Table Operations
let createMessage = function(appId, status, startDate, endDate, message, createdBy) {
    let put_params = {
        "TableName": MessagesTableName,
        "Item": {
            "id": `${appId}-${startDate.getTime()}`,
            "appId": appId,
            "status": status,
            "startDate": startDate,
            "endDate": endDate,
            "message": message,
            "createdBy": createdBy,
            "createdDate": new Date().toISOString(),
            "modifiedBy": null,
            "modifiedDate": null
        }
    };
    return docClient.put(put_params).promise();
};

let updateMessage = function(appId, status, startDate, endDate, message, modifiedBy) {
    let modifiedDate = new Date().toISOString();

    let params = {
        TableName: MessagesTableName,
        Key: { '#a': ':a', '#id': ':id' },
        UpdateExpression: `SET
            #s = :s, 
            #sd = :sd, 
            #ed = :ed, 
            #msg = :msg, 
            #mb = :mb, 
            #md = :md`,
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#id': 'id',
            "#s": 'status',
            "#sd": 'startDate',
            "#ed": 'endDate',
            '#msg': 'message',
            '#mod': 'modified'
        },
        ExpressionAttributeValues: {
            ':a': appId,
            ':id': `${appId}-${startDate}`, 
            ":s": status,
            ":sd": startDate,
            ":ed": endDate,
            ':msg': message,
            ':mb': modifiedBy,
            ':md': modifiedDate
        }
    };
    return docClient.put(params).promise();
};

let readTodaysMessages = function(appId) {
    var params = {
        TableName: MessagesTableName,
        KeyConditionExpression: '#a = :a',
        FilterExpression: '#s = :s and :t >= #sd and :t < #ed',
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#s': 'status',
            '#sd': 'startDate',
            '#ed': 'endDate',
        },
        ExpressionAttributeValues: {
          ':a': appId,
          ':t': new Date().toISOString(),
          ':s': ItemStatus.Approved
        }
    };
    return docClient.query(params).promise();
}

let readPendingMessages = function(appId) {
    var params = {
        TableName: MessagesTableName,
        KeyConditionExpression: '#a = :a',
        FilterExpression: '#s = :s',
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#s': 'status'
        },
        ExpressionAttributeValues: {
          ':a': appId,
          ':s': ItemStatus.Pending
        }
    };
    return docClient.query(params).promise();
}

let readAllMessages = function() {
    var params = {
        TableName: MessagesTableName
    };
    return docClient.scan(params).promise();
}

let deleteMessage = function(appId, startDate, modifiedBy) {
    let modifiedDate = new Date().toISOString();

    let params = {
        TableName: MessagesTableName,
        Key: { '#a': ':a', '#id': ':id' },
        UpdateExpression: 'SET #s = :s, #m = list_append(:mb, #m)', 
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#id': 'id',
            "#s": 'status',
            '#m': 'modified',
        },
        ExpressionAttributeValues: {
            ':a': appId,
            ':id': `${appId}-${startDate}`, 
            ":s": ItemStatus.Deleted,
            ':mb': [{ "modifiedBy" : modifiedBy, "modifiedDate" : modifiedDate }],
        }
    };
    return docClient.put(params).promise();
};
//#endregion

//#endregion

//#region US-E-UXD-Users Table

//#region Users Schema
/*
    US-E-UXD-Users Schema
    {
        id          - GUID or sequence id
        appIds[]    - a list of application ids they have rights for
        role[]      - a list of roles available to this user
        status      - the status of the user [Active|Deleted]
        createdBy   - who created this user
        createdDate - the date the users was created
        lastLogin   - the date of the users last login
        modified[]  - a list of modified by and date { 'modifiedBy': '', 'modifiedDate': '' }
    }
*/
//#endregion

//#region User Table Operations
let createUser = function(id, appIds, roles, createdBy, modifiedBy) {
    let params = {
        TableName: UsersTableName,
        Item: {
            id: id,
            appIds: appIds,
            roles: roles,
            createdBy: createdBy,
            createdDate: new Date().toISOString(),
            modified: [{modified: modifiedBy, modifiedDate: new Date().toISOString()}]
        }
    };
    return docClient.put(params).promise();
};

let updateUsers = function(id, appIds, roles, modifiedBy) {
    let modifiedDate = new Date().toISOString();

    let params = {
        TableName: MessagesTableName,
        Key: { '#a': ':a', '#id': ':id' },
        UpdateExpression: `SET
            #s = :s, 
            #sd = :sd, 
            #ed = :ed, 
            #msg = :msg, 
            #mb = :mb, 
            #md = :md`,
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#id': 'id',
            "#s": 'status',
            "#sd": 'startDate',
            "#ed": 'endDate',
            '#msg': 'message',
            '#mod': 'modified'
        },
        ExpressionAttributeValues: {
            ':a': appId,
            ':id': `${appId}-${startDate}`, 
            ":s": status,
            ":sd": startDate,
            ":ed": endDate,
            ':msg': message,
            ':mb': modifiedBy,
            ':md': modifiedDate
        }
    };
    return docClient.put(params).promise();
};

let readUsersByAppId = function(id, appId) {
    var params = {
        TableName: UsersTableName,
        KeyConditionExpression: '',
        ExpressionAttributeNames: {
        },
        ExpressionAttributeValues: {
        }
    };
    return docClient.query(params).promise();
}

let readUser = function(id, appId) {
    var params = {
        TableName: UsersTableName,
        KeyConditionExpression: '',
        FilterExpression: '',
        ExpressionAttributeNames: {
        },
        ExpressionAttributeValues: {
        }
    };
    return docClient.query(params).promise();
}

let readAllUsers = function() {
    var params = {
        TableName: UsersTableName
    };
    return docClient.scan(params).promise();
}

let deleteUser = function(id, appId, modifiedBy) {
    let modifiedDate = new Date().toISOString();

    let params = {
        TableName: UsersTableName,
        Key: { '#a': ':a', '#id': ':id' },
        UpdateExpression: 'SET #s = :s, #m = list_append(:mb, #m)', 
        ExpressionAttributeNames: {
            '#a': 'appId',
            '#id': 'id',
            '#s': 'status',
            '#ll': 'lastLogin',
            '#m': 'modified',
        },
        ExpressionAttributeValues: {
            ':a': appId,
            ':id': `${appId}-${startDate}`, 
            ':s': ItemStatus.Deleted,
            ':mb': [{ "modifiedBy" : modifiedBy, "modifiedDate" : modifiedDate }],
        }
    };
    return docClient.put(params).promise();
};
//#endregion

//#endregion

//#endregion

//#region Rxjs and Socket.io
const io$ = of(io(http));

/**
 * @description
 * connection$ is an observable created from io 'connection' events. <fromEvent(io, 'connection')>.
 * The incoming client is 'mapped' with the io and socket(client) as a single object and placed into the inside observable.
 * SwitchMap is used to create a new inside observable, needed so we dont have memory leaks and orphaned connections, when a user connects.
 */
const connection$ = io$.pipe(
    switchMap( io => fromEvent(io, 'connection').pipe(
        map(client => ({io, client}))
    ))
);

/**
 * @description
 * disconnect$ is another observable created from the 'disconnect' event listening to the 'connection$' obserable.
 * Merges the outer observable(connection$)  the inner observable(disconnect$).
 */
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
    console.log('client disconnected', client.id);
    //client.emit('message',  new AdminMessageRef('message', 'user left'));
});

//#endregion

//#region Http Server
http.listen(55000, () => {
    console.log('server listening on port 55000');
});
//#endregion