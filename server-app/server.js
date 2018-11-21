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
const dynamodbTranslator = docClient.getTranslator();

let ItemShape = docClient.service.api.operations.getItem.output.members.Item;
//console.log('item shape:', JSON.stringify(ItemShape, null, 2));

let dbSubject$ = new Subject();

let getMessageByKey = function(id, audience) {
    var params = { 
        TableName: "Messages",
        Key: { id: id, audience: audience }
    };
    docClient.get(params, function(err, data) {
        if (err)
            console.err('error failed to get data', id, audience, JSON.stringify(err, null, 2));
        else {
            console.log('get successful', id, audience, JSON.stringify(data, null, 2));
            if(data && data.Item)
                dbSubject$.next(data.Item);
        }
    });
}

let getCurrentMessagesForAudience = function(audience) {
    var params = { 
        TableName: 'Messages',
        KeyConditionExpression: '#a = :v',
        ExpressionAttributeNames: { '#a': 'audience' },
        ExpressionAttributeValues: { ':v': audience, }
    };
    return docClient.query(params).promise();
}

let getAllCurrentMessages = function() {
    var params = { 
        TableName: "Messages",
        Key: { id: id, audience: audience }
    };
    docClient.get(params, function(err, data) {
        if (err)
            console.err('error failed to get data', id, audience, JSON.stringify(err, null, 2));
        else {
            console.log('get successful', id, audience, JSON.stringify(data, null, 2));
            if(data && data.Item)
                dbSubject$.next(data.Item);
        }
    });
}

module.exports.handler = function(event, context, callback) {
    event.Records.forEach(function(record) {
        record.dynamodb.OldImage = dynamodbTranslator.translateOutput(record.dynamodb.OldImage, ImageShape);
        record.dynamodb.NewImage = dynamodbTranslator.translateOutput(record.dynamodb.NewImage, ImageShape);
    });
}
//#endregion


//#region RXJS IO Wrapper
const io$ = of(io(http));

const connection$ = io$.pipe(
    switchMap( io => fromEvent(io, 'connection').pipe(
        map(client => ({io, client, dbSubject$}))
    ))
);
const disconnect$ = connection$.pipe(
    mergeMap( ({client}) => fromEvent(client, 'disconnect').pipe(
        map(() => client)
    ))
);

connection$.subscribe( ({io, client}) => {
    console.log('client connected', client.id);
    //io.emit('message',  new MessageRef('message', 'user joined'));

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
    const clientMessages$ = fromEvent(client, 'client-message').pipe(takeUntil(disconnect$));

    clientMessages$.subscribe(clientMessage => {
        console.log('clientMessage', clientMessage, 'client id', client.id);
        // do stuff with message
        // in this case we resend to all clients
        // TODO:
        //  1) validate the message - parse out all code or make trusted... based on our policy
        //  2) all business logic should go here to determine if a message should be broadcasted
        io.emit('message', new MessageRef('message', clientMessage));
    });

    //==============================================================================================================
    // SERVER sent messages (from database where the current date is within the range of the startDate and endDate of the message)
    //==============================================================================================================
    // the audience should come from somewhere... idk where yet though

    let targetAudience = 'test1';
    getCurrentMessagesForAudience(targetAudience)
    .then(function(data) {
        if(data && data.Items) {
            var today = new Date();
            var results = data.Items.filter( m => {
                var start = new Date('2018-11-20T14:58:24.155Z');
                var end = new Date('2018-11-24T14:58:24.155Z');
                return (today >= start && today <= end);
            });
            if(results) {
                // emit the database messages to all clients
                results.forEach(function(r) {
                    io.emit('message', new MessageRef('db-message', r.message));
                });
            }
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



