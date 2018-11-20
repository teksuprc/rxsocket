let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io');

const aws = require('aws-sdk');

const { timer, Observable, Subscription, of, from, fromEvent, interval, Subject } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, mapTo, tap, switchMap, merge, mergeMap, filter, take, takeUntil,
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
console.log('item shape:', JSON.stringify(ItemShape, null, 2));

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
        map(client => ({io, client}))
    ))
);
const disconnect$ = connection$.pipe(
    mergeMap( ({client}) => fromEvent(client, 'disconnect').pipe(
        map(() => client)
    ))
);

connection$.subscribe( ({io}) => {
    console.log('client connected');
    io.emit('message',  new MessageRef('message', 'user joined'));
});

disconnect$.subscribe( client => {
    console.log('client disconnected');
    client.emit('message',  new MessageRef('message', 'user left'));
});


//#endregion

http.listen(4000, () => {
    console.log('server listening on port 4000');
});

