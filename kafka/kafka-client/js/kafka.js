var kafka = require('kafka-node');

var Consumer = kafka.Consumer;
var client = new kafka.KafkaClient({kafkaHost: 'localhost:9092'}),
    consumer = new Consumer(client, 
    [{topic: 'mytopic', partition: 0}], 
    {autoCommit: false});

consumer.on('message', (msg) => {
    console.log('got message', msg);
});


