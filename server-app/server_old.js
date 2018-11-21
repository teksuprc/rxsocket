let app = require('express')();
let http = require('http').Server(app);
let io = require('socket.io')(http);

const aws = require('aws-sdk');

const { timer, Observable, Subscription, of, from, interval, Subject } = require('rxjs');
const { ajax } = require('rxjs/ajax');
const { map, mapTo, tap, switchMap, merge, mergeMap, filter, take, takeUntil,
        catchError, concat, flatMap, multicast, refCount, share } = require('rxjs/operators');


//#region SocketIO
let msgArr = [
    {song:'Jingle Bells', lyric: 'Jingle bells, jingle bells, jingle all the way!'},
    {song:'Merry Christmas', lyric: 'We wish you a merry Christmas!'},
    {song:'Merry Christmas', lyric: 'And a happy New Year!'},
    {song:'Jingle Bells', lyric: 'Dashing through the snow, in a one-horse open sleigh'},
    {song:'Jingle Bells', lyric: 'Over the fields we go, laughing all the way'},
    {song:'Jingle Bells', lyric: 'Ha ha ha ha ha'},
    {song:'Frosty the Snowman', lyric: 'Frosty the snowman was a jolly happy soul'},
    {song:'Frosty the Snowman', lyric: 'With a corncob pipe and a button nose'},
    {song:'Frosty the Snowman', lyric: 'and two eyes made out of coal'},
    {song:'Frosty the Snowman', lyric: 'Frosty the snowman is a fairy tale they say'},
    {song:'Jingle Bells Batman', lyric: 'Jingle bells, Batman smells, Robin laid an egg'},
    {song:'Jingle Bells Batman', lyric: 'He lost his pants down in France, and found them in Bombay'},
    {song:'Jingle Bells Batman', lyric: 'The batmobile lost its wheel and the Joker got a way'}
];

let sample_data = [
    { id: 0, mid: "1", audience: 'test1', message: "test1 message 1" },
    { id: 1, mid: "2", audience: 'test1', message: "test1 message 2" },
    { id: 2, mid: "3", audience: 'test2', message: "test2 message 1" },
    { id: 3, mid: "4", audience: 'test2', message: "test2 message 2" },
    { id: 4, mid: "5", audience: 'test3', message: "test3 message 1" }
];

let dbsubj$ = new Subject();
let dbsrc$ = new Observable();

// every 5 secs... emit a message
const src = timer(0, 10000);
const example = src.pipe( map( () => msgArr[getRandomInt(0,4)].lyric ));

const config = {
    "apiVersion": "2012-08-10",
    "accessKeyid": "abcde",
    "secretAccessKey": "abcde",
    "region": "us-east-1",
    "endpoint": "http://localhost:8000"
};

const dynamo = new aws.DynamoDB(config);
//aws.config.update({"region": "us-east-1"})
let docClient = new aws.DynamoDB.DocumentClient(config);

let databaseInit = function() {
    //createMessageTable();
    loadSampleData();
}

let createMessageTable = function() {
    var params = {
        TableName: "Messages",
        KeySchema: [
            { AttributeName: "audience", KeyType: "HASH" },
            { AttributeName: "id", KeyType: "RANGE" }
        ],
        AttributeDefinitions: [
            { AttributeName: "audience", AttributeType: "S" },
            { AttributeName: "id", AttributeType: "N" }
        ],
        ProvisionedThroughput: {
            ReadCapacityUnits: 5,
            WriteCapacityUnits: 5
        }
    };

    dynamo.createTable(params, function(err, data) {
        if(err)
            console.log('failed to "Messages" create table:', JSON.stringify(err, null, 2));
        else {
            console.log('Messages table successfully created');
            loadSampleData();
        }
    });
}

let loadSampleData = function() {
    sample_data.forEach(function(row) {
        var put_params = {
            "TableName": "Messages",
            "Item": {
                "id": row.id,
                "audience": row.audience,
                "visibility": "UT",
                "startDate": new Date().toISOString(),
                "endDate": new Date().toISOString(),
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
    });
}

let get = function(id, audience) {
    var params = { 
        TableName: "Messages",
        Key: {
            id: id,
            audience: audience
        }
    };

    docClient.get(params, function(err, data) {
        if (err)
            console.log('failed to scan table', JSON.stringify(err, null, 2));
        else {
            //console.log('scan complete', JSON.stringify(data.Item));
            if(data && data.Item)
                dbsubj$.next(data.Item);
        }
    });
}

let scan = function(table, filter, attrName, attrValue) {
    var params = {
        TableName: table ? table : 'Messages',
        FilterExpression: filter ? filter : null,
        ExpressionAttributeNames: attrName ? attrName : null,
        ExpressionAttributeValues: attrValue ? attrValue : null
    };
    return docClient.scan(params).promise; //, function(err, data) {
    /*
        if (err)
            console.log('failed to scan table', JSON.stringify(err, null, 2));
        else
            console.log('scan complete', data.Items);
    });
    */
}

let deleteAll = function() {
    sample_data.forEach(function(row) {
        deleteById(row.id, row.audience);
    });
}

let deleteById = function(id, audience) {
    var params = {
        TableName: "Messages",
        Key: { id: id, audience: audience }
    };
    docClient.delete(params, function(err, data) {
        if (err)
            console.log('failed to delete', JSON.stringify(err, null, 2));
        else
            console.log('delete complete', data);
    });
}

//databaseInit();
//deleteAll();
//loadSampleData();
//scan();
/*
setTimeout(function() {
    sample_data.forEach(function(row) {
        get(row.id, row.audience);
    });
}, 3000);

*/

let MessageRef = function(type, message) {
    return {
        type: type,
        datetime: new Date().toISOString(),
        text: message
    };
}

let getRandomInt = (min, max) => {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

io.on('connection', (socket) => {
    console.log('connection established');

    io.emit('message',  new MessageRef('message', 'welcome to the server'));

    //example.subscribe(m => {
    //    io.emit('message', new MessageRef('message', m));
    //});

    let dbsub$ = dbsubj$.subscribe(r => {
        console.log('sending', r.message);
        io.emit('message', new MessageRef('db message', `${r.id} - ${r.message}`));
    });

    socket.on('disconnect', () => {
        console.log('disconnected');
        if(dbsub$) {
            dbsub$.unsubscribe();
            dbsub$ = null;
        }
    });

    socket.on('send-message', (message) => {
        io.emit('message',  new MessageRef('message', message));
    });

    socket.on('receive-message', (message) => {
        if(message.type === 'message') {
            console.log('message', message.text);
        }
    });

    socket.on('db-message', (message) => {
        console.log('db-message', message);
        var tokens = message.split(',');
        var id = parseInt(tokens[0]);
        var audience = tokens[1];
        get(id, audience);
    });
});

http.listen(4000, () => {
    console.log('server listening on port 4000');
});

//#endregion

//#region RXJS NOTES

//#region Observables
/*
=============================================================
    NOTES
=============================================================
*//*
Observable - from rxjs
    3 methods
        next
        error
        complete

    variable naming convention
        myObservable$

    creating
        myObservable$ = new Observable();
        ofObservable$ = of(); // list of arguments of('hello', 42, 'test');
        fromObservable$ = from(); // from array or promise

    joining observables
        concat(ofObservable$, fromObservable$);

    execution
        dones when a object subscribes to it
            myObservable$.subscribe( (m) => console.log(m) );

    read button click events
        let button = document.getElementById('mybutton');
        fromEvent(button, 'click').subscribe(evt => console.log(evt) );


AJAX - from rxjs/ajax

    use RXJS to read ajax promise
        let button = document.getElementById('mybutton');
        fromEvent(button, 'click').subscribe(evt => {
            ajax(rest_url).subscribe(res => {
                console.log(res);
            });
        });
=====================================================================================
*/
/*
let observableNotes = () => {

    let books = [
        'Call of the Wild',
        'The Hunt for Red October',
        'Executive Decisions'
    ]

    let subscribe = (subscriber) => {

        for(let book of books) {
            subscriber.next(book);
        } 
    };

    let booksObservable$ = new Observable(subscribe);
    let books2Observable$ = from(books);
    let books3Observable$ = of('Hello World!', 42, books[0], books[1]);
    
    booksObservable$.subscribe(book => console.log(book) );
    books2Observable$.subscribe(book => console.log(book) );
    books3Observable$.subscribe(book => console.log(book) );
    
};


observableNotes();
*/
//#endregion

//#region Cancel Subscribe
/*
// 1 sec interval of integers
let timer$ = interval(1000);

// implements the: next, error, complete methods
let timerSub = timer$.subscribe( 
    val => console.log(`${new Date().toLocaleTimeString()} (${val})`),
    (err) => console.error('error', err),
    () => console.log('complete')
);

let interval1 = setInterval(() => {
    console.log('unsub');
    if(timerSub) {
        timerSub.unsubscribe();
        timerSub = null;
        clearInterval(interval1);
    }

}, 5100);
*/
//#endregion

//#region Operators
/*
console.log('====================================================================');
console.log('Operators');
let source$ = of(1,2,3,4,5);

// 1) the long winded way to make it
//let doubler = map(val => val * 2);
//let doubled$ = doubler(source$);
//doubled$.subscribe(val => console.log(val));

// 2) older coding way rxjs <5.5
//source$
//    .map(val => val * 2)
//    .filter(m => m > 5)
//    .subscribe(v => console.log(v));

// 3) newer coding way rxjs 5.5+
// pipe takes comma separated functions that are chained
source$.pipe(
    map(v => v * 2),
    filter(v => v > 5)
).subscribe(v => console.log(v));
console.log('====================================================================');
*/
//#endregion

//#region Categories of Operators
/*
Transformation - returns different values from the source
Filtering - filter out data
Combination - combine 2 or more observables
Utility - how or when values are produced w/o changing what values are produced.
Conditional - produce a value if a condition is met... like filter
Aggregate - aggregate values into a single value i.e. min, max
Multicasting - unique to subjects

take(# of values) - takes values and completes
takeUntil - 

multicast(subject) - returns a connectable observable. must call connect()
refCount() - executes when # of observers > 0
publish() - 
share() - executes when # of observers > 0, resubscribes as necessary


*/
//#endregion

//#region Marble Diagrams
/*
top line is the source observable
vertical line is the completion of the data
marbles represent data at different time intervals
the function is in the middle
the bottom line is the resulting values of the observable
*/
//#endregion

//#region Using Operators
/*
console.log('====================================================================');
console.log('Using Operators');

let msgs$ = from(msgArr);

msgs$.pipe(
    map( m => m.song )
).subscribe(v => console.log('msg', v));

console.log('====================================================================');
*/
//#endregion

//#region Errors
/*
catchError - catch errors thrown by an observable, returns an observable
    catchError(err => of({type:'msg', val:'error happened'}))
    catchError((err, caught)) => caught)
    catchError(err=> throw `an error happened here... ${err.message}`)
    catchError(err=> throwError(err.message)

console.log('====================================================================');
console.log('Errors');



console.log('====================================================================');
*/
//#endregion

//#region Custom Operators
/*
operator - is just a function
    function myop(config1, config2) {
        return function(source$) {
            return newObservable$;
        }
    }
console.log('====================================================================');
console.log('Custom Operators');
console.log('====================================================================');
*/
//#endregion

//#region Subjects and Multicast Observables
/*
Subject - child of Observable, 
    observer and subscribe to observables
    product values
    can proxy values
    maintain state
    can multicast
    maintains a list of observers

    Observable          Subject             Observer1                                     
        subscribe()         next()              next()
                            error()             error()
                            complete()          complete()
                            subscribe()
                                            Observer2
                                                next()
                                                error()
                                                complete()

Cold Observables                            |              Hot Observables
==========================================================================================
value producer inside observable            |   values exists outside observable
one observer per execution (when subscribe) |   muiltiple observers that get the same values
unicast                                     |   multicast   
interval(), ajax()                          |   fromEvent, websockets


*/
//console.log('====================================================================');
//console.log('Subjects and Multicast Observables');
/*
let subject$ = new Subject();
subject$.subscribe(v => console.log('ob1', v));
subject$.subscribe(v => console.log('ob2', v));
subject$.next('hello');

let src$ = new Observable(s => {
    s.next(`Greetings!`);
});
src$.subscribe(subject$);

// cold observable (interval - value is inside the observable)
console.log('cold observable');
let src1$ = interval(1000).pipe(take(4));
src1$.subscribe(v => console.log('ob1', v));

setTimeout(() => {
    src1$.subscribe(v => console.log('ob2', v));
}, 1000);

setTimeout(() => {
    src1$.subscribe(v => console.log('ob3', v));
}, 2000);
*/
//==========================================================

// hot observable (proxy interval with a subject and multicast from the subject)
//console.log('hot observable using a subject');
//let src2$ = interval(1000).pipe(take(5));
// change to multicast

// test 
//let numsrc$ = interval(1000).pipe(take(5));

//let src2$ = interval(1000).pipe(
//    tap(() => console.log('start tap')),
//    take(5),
//    multicast( () => new Subject())
//);

//let src2$ = numsrc$.pipe(
//    tap(() => console.log('start tap')),
//    map(v => 'test' + v)
//);

// commented out because we now use multicast
//let subj1$ = new Subject();
//src2$.subscribe(subj1$);
//subj1$.subscribe(v => console.log('ob1', v));
//setTimeout(() => {
//    subj1$.subscribe(v => console.log('ob2', v));
//}, 2800);
//setTimeout(() => {
//    subj1$.subscribe(v => console.log('ob3', v));
//}, 4000);

//src2$.subscribe(v => console.log('ob1', v));
//setTimeout(() => {
//    src2$.subscribe(v => console.log('ob2', v));
//}, 2000);
//setTimeout(() => {
//    src2$.subscribe(v => console.log('ob3', v));
//}, 3000);

//src2$.connect();

//console.log('====================================================================');
//#endregion


//#region copy
/*
console.log('====================================================================');
console.log('region');
console.log('====================================================================');
*/
//#endregion


//#endregion

 