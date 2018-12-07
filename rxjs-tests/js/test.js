var client = (function() {
    'use strict';

    var nickname = 'bob';
    var appId = 'test1';
    var allowJoin = false;
    var socket = null;
    var joined = false;
    var clientName = 'client-'+new Date().getTime();

    document.getElementById('btnConnect').disabled = false;
    document.getElementById('btnDisconnect').disabled = true;

    var join = function() {
        nickname = document.getElementById('nickname').value;
        var select = document.getElementById('appId');
        appId = select.options[select.selectedIndex].value;

        if(nickname && (nickname.length > 3) && appId) {
            connect();
        }
    };

    var disconnect = function() {
        if(socket && joined) {
            socket.disconnect();
            document.getElementById('btnConnect').disabled = false;
            document.getElementById('btnDisconnect').disabled = true;
        }
    };

    var emitFake = function() {
        if(socket && joined) {
            socket.emit('join', { name: 'the ogre', appId: 'test3' });
            socket.emit('test3-message', 'I R has connected');
            socket.emit('admin-message', {appId: null, message: 'you got hijacked foo!'});
        }
    };

    var connect = function() {
        try {

            socket = io('https://localhost:4433', {
                forceNew: false,
                secure: true,
                reconnect: true,
                reconnectionAttempts: 'Infinity',
                reconnectionDelay: 5000,
                reconnectionDelayMax: 10000,
                randomizationFactor: 0.5,
                autoConnect: true,
                /*
                path: `/${appId}`,
                upgrade: true,
                */
                // NOTE: these are nodejs client side ONLY
                //key: 'private key for ssl',
                //cert: 'x509 certificate,
                //ca: 'certificate authority',
                //cipher: 'the cipher to use [tls1_3, tls1_2, tls1_1, tls1, ssl3, aes256, sha256] TLS_RSA_WITH_AES_256_CBC_SHA            AES256-SHA'
                transport: ['websocket', 'polling']
            });

            socket.on('connect', function() {
                console.log('client connect', nickname, appId, socket.id);
                socket.emit('join', { name: nickname, appId: appId });
                document.getElementById('btnConnect').disabled = true;
                document.getElementById('btnDisconnect').disabled = false;  
                joined = true;          
            });

            socket.on(`${appId}-message`, function(msg) {
                //console.log('message', msg);
                var el = document.getElementById('messages');
                el.innerHTML += `<li>[${msg.appId} ${msg.datetime}]:&nbsp;&nbsp;${msg.text}</li>`;
                el.scrollTop = el.scrollHeight;
            });

            socket.on('disconnect', function() {
                console.log('client disconnected');
            });
        }
        catch(err) {
            console.log(err.message);
        }
    };

    return {
        join: join,
        disconnect: disconnect,
        emitFake, emitFake
    };

})();

