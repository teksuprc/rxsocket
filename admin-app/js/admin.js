var rxjs_test = (function() {
'use strict';

    let socket = io('http://localhost:4000');
                
    socket.on('connect', function() {
        console.log('client connect');
    });

    socket.on('message', function(msg) {
        console.log('message', msg);
        var el = document.getElementById('messages');
        el.innerHTML += '<li>[' + msg.datetime + ']:&nbsp;&nbsp;' + msg.text + '</li>';
        el.scrollTop = el.scrollHeight;
    });

    socket.on('disconnect', function() {
        console.log('client disconnect');
    });

    function sendAdminMessage() {
        var text = document.getElementById('inputTxt').value;
        socket.emit('admin-message', text);
    };

    return {
        sendAdminMessage: sendAdminMessage
    };
})();

