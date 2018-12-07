var adminClient = (function() {
'use strict';

    var nickname = 'bob';
    var appId = 'test1';
    var socket = null;
    var joined = false;
    var clientList;
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
        if(socket) {
            socket.disconnect();
            document.getElementById('btnConnect').disabled = false;
            document.getElementById('btnDisconnect').disabled = true;
        }
    };

    var connect = function() {
        try {
            socket = io('https://localhost:4433', {secure: true});

            socket.on('connect', function() {
                console.log(`${socket.id} connected`);
                socket.emit('join', { name: nickname, appId: appId });
                document.getElementById('btnConnect').disabled = true;
                document.getElementById('btnDisconnect').disabled = false;
            });

            socket.on(`${appId}-message`, function(msg) {
                //console.log('message', msg);
                var el = document.getElementById('messages');
                el.innerHTML += `<li>[${msg.appId} ${msg.datetime}]:&nbsp;&nbsp;${msg.text}</li>`;
                el.scrollTop = el.scrollHeight;
            });

            socket.on(`admin-connect-report`, function(msg) {
                var el = document.getElementById('messages');
                
                var html = `<li>[${msg.appId} ${msg.datetime}]
                    <div style="background-color: #d7d7d7;">
                        <div>Total Clients: ${msg.text.total}</div>
                        <div style="text-align: center;"><div style="background-color: green;">Client Connected:</div> ${msg.text.client.nickname} | ${msg.text.client.appId} | ${msg.text.client.connectionTime} | ${msg.text.client.id}</div>
                    </div>
                    </li>`;

                // add client to clientList

                el.innerHTML += html;
                el.scrollTop = el.scrollHeight;
            });

            socket.on(`admin-disconnect-report`, function(msg) {
                var el = document.getElementById('messages');
                
                var html = `<li>[${msg.appId} ${msg.datetime}]
                    <div style="background-color: #d7d7d7;">
                        <div>Total Clients: ${msg.text.total}</div>
                        <div style="text-align: center;"><div style="background-color: red;">Client Disconnect:</div> ${msg.text.client.nickname} | ${msg.text.client.appId} | ${msg.text.client.connectionTime} | ${msg.text.client.id}</div>
                    </div>
                    </li>`;

                // remove client from clientList

                el.innerHTML += html;
                el.scrollTop = el.scrollHeight;
            });
            
            socket.on(`admin-get-clients`, function(msg) {
                var el = document.getElementById('clients');
                
                clients = msg.text.clients;
                var html = '';
                for(var c of msg.text.clients) {
                    html += `<li>${c.nickname} | ${c.appId} | ${c.id}</li>`;
                }
                el.innerHTML = html;
            });

            socket.on('disconnect', function() {
                console.log('disconnected');
            });

            joined = true;
        }
        catch(err) {
            console.log(JSON.stringify(err, null, 2));
        }
    };

    var sendMessage = function() {
        if(joined) {
            var select = document.getElementById('appId');
            appId = select.options[select.selectedIndex].value;
            var text = document.getElementById('inputTxt').value;
            if(appId === 'global')
                socket.emit('admin-message', {appId: null, message: text});
            else
                socket.emit('admin-message', {appId: appId, message: text});
        }
    };

    var getClients = function() {
        if(joined) {
            socket.emit('admin-get-clients');
        }
    };

    return {
        join: join,
        disconnect: disconnect,
        sendMessage: sendMessage,
        getClients: getClients
    };
})();
