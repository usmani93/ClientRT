const outgoingVideo = document.getElementById('outgoingVideo');
const incomingVideo = document.getElementById('incomingVideo');
const userInput = document.getElementById('userName');
const messageInput = document.getElementById('message');
const showMessage = document.getElementById('messageReceived');
const connectionId = document.getElementById('connectionId');
const connectedUsers = document.getElementById('connectedUsers');
const startButton = document.getElementById('startButton');
const callButton = document.getElementById('callButton');
const hangupButton = document.getElementById('hangupButton');
let localPeerConnection;
var connections = {};

const mediaStreamConstraints = {
    video: true,
    audio: false
};

let localStream;

const configuration = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

//get video stream and show it to as outgoing video
navigator.mediaDevices.getUserMedia(mediaStreamConstraints)
    .then(getLocalMediaStream)
    .catch(handleLocalMediaStreamError);

function getLocalMediaStream(mediaStream) {
    localStream = mediaStream;
    outgoingVideo.srcObject = mediaStream;

    //localStream.getTracks().forEach((track) => connections.addTrack(track, localStream));
}

function handleLocalMediaStreamError(error) {
    console.log('navigator.getUserMedia error:', error);
}

//connect to signalr hub
const hubConnection = new signalR.HubConnectionBuilder()
    .configureLogging(signalR.LogLevel.Debug)
    //.withUrl("https://localhost:7124/hub/rthub")
    .withUrl("https://serverrt4-samiusmani48.b4a.run/hub/rthub")
    .build();
    
startConnection();

async function startConnection() {
    try {
        await hubConnection.start().then(function(){
            connectionId.innerHTML = hubConnection.connectionId;
            console.log("SignalR Connected.");
        });
    } catch (err) {
        console.log(err);
        setTimeout(startConnection, 5000);
    }
};

hubConnection.onclose(async () => {
    await startConnection();
})

function startFunction(){
    console.log("Connected");
}
function startErrorCatch(err){
    console.log(err);
}

function getId(){
    console.log("b");
    hubConnection.invoke("Join", "Sa")
    .then(function(){
        console.log("join");
    }).catch(function(err){
        return console.log(err.toString());
    });
}

    hubConnection.on('updateUserList', (userList) => {
        //console.log(JSON.stringify(userList));
        connectedUsers.innerHTML = "";
        console.log('SignalR: called updateUserList' + JSON.stringify(userList));
        userList.forEach((item) => {
            let li = document.createElement("li");
            li.id = "userId";
            li.addEventListener("click", onclickUser, false);
            li.myValue = item;
            li.innerHTML = item.username + " " + item.connectionId;
            connectedUsers.appendChild(li);
        });
    });

    function onclickUser(item){
        console.log('calling user... ');
        const targetConnectionId = item.currentTarget.myValue;
        console.log("to: " + targetConnectionId.connectionId);
        console.log("from: " + connectionId.innerText);
        // Then make sure we aren't calling ourselves.
        if (targetConnectionId.connectionId != connectionId.innerText) {
            // Initiate a call
            hubConnection.invoke('CallUser', { "connectionId": targetConnectionId.connectionId });
            // UI in calling mode
            startButton.innerText = "In Call";
        } else {
            console.log("Ah, nope.  Can't call yourself.");
            startButton.innerText = "Start";
        }
    }

    //incoming call
    hubConnection.on('incomingCall', (callingUser) => {
        console.log('SignalR: incoming call from: ' + JSON.stringify(callingUser));
        // I want to chat
        //callButton.disabled = true;
        hubConnection.invoke('AnswerCall', true, callingUser).catch(err => console.log(err));
    });

    // Add handler for the hangup button
    hangupButton.onclick = (function () {
        console.log('hangup....');
        // Only allow hangup if we are not idle
        //localStream.getTracks().forEach(track => track.stop());
            hubConnection.invoke('hangUp');
            //closeAllConnections();
    });

    // Close all of our connections
    const closeAllConnections = () => {
        console.log("WebRTC: call closeAllConnections ");
        for (var connectionId in connections) {
            closeConnection(connectionId);
        }
    }

    hubConnection.on('callAccepted', (acceptingUser) => {
        console.log('SignalR: call accepted from: ' + JSON.stringify(acceptingUser) + '.  Initiating WebRTC call and offering my stream up...');
        // Callee accepted our call, let's send them an offer with our video stream
        initiateOffer(acceptingUser.connectionId, localStream); // Will use driver email in production
    });

    const initiateOffer = (partnerClientId, stream) => {
        console.log('WebRTC: called initiateoffer: ');
        var connection = getConnection(partnerClientId); // // get a connection for the given partner
        //console.log('initiate Offer stream: ', stream);
        //console.log("offer connection: ", connection);
        connection.addStream(localStream);// add our audio/video stream
        console.log("WebRTC: Added local stream");
    
        connection.createOffer().then(offer => {
            console.log('WebRTC: created Offer: ');
            console.log('WebRTC: Description after offer: ', offer);
            connection.setLocalDescription(offer).then(() => {
                console.log('WebRTC: set Local Description: ');
                console.log('connection before sending offer ', connection);
                setTimeout(() => {
                    sendHubSignal(JSON.stringify({ "sdp": connection.localDescription }), partnerClientId);
                }, 1000);
            }).catch(err => console.error('WebRTC: Error while setting local description', err));
        }).catch(err => console.error('WebRTC: Error while creating offer', err));
    }

    const getConnection = (partnerClientId) => {
        console.log("WebRTC: called getConnection");
        if (connections[partnerClientId]) {
            console.log("WebRTC: connections partner client exist");
            return connections[partnerClientId];
        }
        else {
            console.log("WebRTC: initialize new connection");
            return initializeConnection(partnerClientId)
        }
    }

    const initializeConnection = (partnerClientId) => {
        console.log('WebRTC: Initializing connection...');
        var connection = new RTCPeerConnection(configuration);
        connection.onicecandidate = evt => callbackIceCandidate(evt, connection, partnerClientId); // ICE Candidate Callback
        connection.onaddstream = evt => callbackAddStream(connection, evt); // Add stream handler callback
        connection.onremovestream = evt => callbackRemoveStream(connection, evt); // Remove stream handler callback
        connections[partnerClientId] = connection; // Store away the connection based on username
        return connection;
    }

    // Hub Callback: Call Declined
    hubConnection.on('callDeclined', (decliningUser, reason) => {
    console.log('SignalR: call declined from: ' + decliningUser.connectionId);
});

hubConnection.on('callEnded', (signalingUser, signal) => {
    //console.log(signalingUser);
    //console.log(signal);

    console.log('SignalR: call with ' + signalingUser.connectionId + ' has ended: ' + signal);
    // Close the WebRTC connection
    closeConnection(signalingUser.connectionId);
});

// Close the connection between myself and the given partner
const closeConnection = (partnerClientId) => {
    console.log("WebRTC: called closeConnection ");
    var connection = connections[partnerClientId];

    if (connection) {
        // Let the user know which streams are leaving
        // todo: foreach connection.remoteStreams -> onStreamRemoved(stream.id)
        onStreamRemoved(null, null);

        // Close the connection
        connection.close();
        delete connections[partnerClientId]; // Remove the property
    }
}

sendHubSignal = (candidate, partnerClientId) => {
    console.log('candidate', candidate);
    console.log('SignalR: called sendhubsignal ');
    hubConnection.invoke('sendSignal', candidate, partnerClientId).catch(errorHandler);
};

function sendMessage() {
    hubConnection.invoke("SendMessage", userInput.value, messageInput.value)
        .then(function () {
            //console.log(userInput.value + messageInput.value);
        }).catch(function (err) {
            return console.log(err.toString());
        })
}

    // Hub Callback: WebRTC Signal Received
hubConnection.on('receiveSignal', (signalingUser, signal) => {
    //console.log('WebRTC: receive signal ');
    //console.log(signalingUser);
    //console.log('NewSignal', signal);
    newSignal(signalingUser.connectionId, signal);
});

// Hand off a new signal from the signaler to the connection
const newSignal = (partnerClientId, data) => {
    console.log('WebRTC: called newSignal');
    //console.log('connections: ', connections);

    var signal = JSON.parse(data);
    var connection = getConnection(partnerClientId);
    console.log("connection: ", connection);

    // Route signal based on type
    if (signal.sdp) {
        console.log('WebRTC: sdp signal');
        receivedSdpSignal(connection, partnerClientId, signal.sdp);
    } else if (signal.candidate) {
        console.log('WebRTC: candidate signal');
        receivedCandidateSignal(connection, partnerClientId, signal.candidate);
    } else {
        console.log('WebRTC: adding null candidate');
        connection.addIceCandidate(null, () => console.log("WebRTC: added null candidate successfully"), () => console.log("WebRTC: cannot add null candidate"));
    }
}

// Process a newly received SDP signal
const receivedSdpSignal = (connection, partnerClientId, sdp) => {
    console.log('connection: ', connection);
    console.log('sdp', sdp);
    console.log('WebRTC: called receivedSdpSignal');
    console.log('WebRTC: processing sdp signal');
    connection.setRemoteDescription(new RTCSessionDescription(sdp), () => {
        console.log('WebRTC: set Remote Description');
        if (connection.remoteDescription.type == "offer") {
            console.log('WebRTC: remote Description type offer');
            connection.addStream(localStream);
            console.log('WebRTC: added stream');
            connection.createAnswer().then((desc) => {
                console.log('WebRTC: create Answer...');
                connection.setLocalDescription(desc, () => {
                    console.log('WebRTC: set Local Description...');
                    console.log('connection.localDescription: ', connection.localDescription);
                    //setTimeout(() => {
                    sendHubSignal(JSON.stringify({ "sdp": connection.localDescription }), partnerClientId);
                    //}, 1000);
                }, errorHandler);
            }, errorHandler);
        } else if (connection.remoteDescription.type == "answer") {
            console.log('WebRTC: remote Description type answer');
        }
    }, errorHandler);
}

const receivedCandidateSignal = (connection, partnerClientId, candidate) => {
    //console.log('candidate', candidate);
    //if (candidate) {
    console.log('WebRTC: adding full candidate');
    connection.addIceCandidate(new RTCIceCandidate(candidate), () => console.log("WebRTC: added candidate successfully"), () => console.log("WebRTC: cannot add candidate"));
    //} else {
    //    console.log('WebRTC: adding null candidate');
    //   connection.addIceCandidate(null, () => console.log("WebRTC: added null candidate successfully"), () => console.log("WebRTC: cannot add null candidate"));
    //}
}

const callbackAddStream = (connection, evt) => {
    console.log('WebRTC: called callbackAddStream');
    // Bind the remote stream to the partner window
    //var otherVideo = document.querySelector('.video.partner');
    //attachMediaStream(otherVideo, evt.stream); // from adapter.js
    attachMediaStream(evt);
}

attachMediaStream = (e) => {
    //console.log(e);
    console.log("OnPage: called attachMediaStream");
    if (incomingVideo.srcObject !== e.stream) {
        incomingVideo.srcObject = e.stream;
        console.log("OnPage: Attached remote stream");
    }
};

const callbackIceCandidate = (evt, connection, partnerClientId) => {
    console.log("WebRTC: Ice Candidate callback");
    //console.log("evt.candidate: ", evt.candidate);
    if (evt.candidate) {// Found a new candidate
        console.log('WebRTC: new ICE candidate');
        //console.log("evt.candidate: ", evt.candidate);
        sendHubSignal(JSON.stringify({ "candidate": evt.candidate }), partnerClientId);
    } else {
        // Null candidate means we are done collecting candidates.
        console.log('WebRTC: ICE candidate gathering complete');
        sendHubSignal(JSON.stringify({ "candidate": null }), partnerClientId);
    }
}