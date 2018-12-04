var kafka = require('kafka-node'),
    Producer = kafka.Producer,
    KeyedMessage = kafka.KeyedMessage,
    client = new kafka.Client(),
    producer = new Producer(client),
    km = new KeyedMessage('key', 'message'),
    payloads = [
        {topic: 'mytopic', messages: ['hello', 'there', 'to', 'all', 'the']},
        {topic: 'mytopic', messages: ['world']}
    ];

producer.on('ready', () => {
    producer.send(payloads, (err, data) => {
        if(err)
            console.log('error', JSON.stringify(err, null, 2));
        else
            console.log('sent', data);
    });
});

producer.on('error', (err) => {
    console.log('got an error', JSON.stringify(err, null, 2));
})

