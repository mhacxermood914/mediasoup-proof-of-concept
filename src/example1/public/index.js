const io = require('socket.io-client')
const socket = io('/mediasoup')
// const { v4: uuidv4 } = require('uuid');
const mediasoupclient = require('mediasoup-client')
const videoContainer = document.getElementById('videoContainer')
const roomName = document.location.pathname.split('/')[2]
const onlysender = true
let producers = [] , localStream
const remoteVideo = document.getElementById('remoteVideo')
let params= {
    encoding:[
        {
            rid:'r0',
            maxBitRate: 100000,
            scalabilityMode:'S1T3'
        },
        {
            rid:'r1',
            maxBitRate: 300000,
            scalabilityMode:'S1T3'
        },
        {
            rid:'r2',
            maxBitRate: 900000,
            scalabilityMode:'S1T3'
        }
    ],
    codecOptions:{
        videoGoogleStartBitRate:1000
    }
}, device, rtpCapabilities;

console.log({roomName})

socket.on('newuserjoined', (data)=>{
    console.log("new user joined",data)
})

let existingProducers=[]

socket.on('newproducer', (data)=>{
    console.log("new producer",{data})
    socket.emit('getProducers', (data)=>{
        console.log({data})
        producers = data.producers
        // if(!existingProducers.length){
            producers.forEach(element => {
                if(!existingProducers.includes(element.producerId)){
                    consumeProducersTracks(element.producerId)
                }else{
                    console.log("already exists", element.producerId)
                }
            });
        // }else{
        //     setTimeout(()=>{
        //         const last = data.producers.pop()
     
        //         let arr = [].push(last)
     
     
        //         console.log({arr,last})
        //         arr.forEach(element => {
        //              consumeProducersTracks(element.producerId)
        //         });
        //     },2000)
        // }
    })
})


const init = ()=>{
    joinRoom()
}

const addElements= (id,  stream)=>{
    const newElem = document.createElement('div')
    newElem.setAttribute('id', `div-${id}`)
    // newElem.setAttribute('class', 'remoteVideo')
    newElem.innerHTML = "<video id="+id+" autoplay class='video'></video>"
    videoContainer.appendChild(newElem)

    document.getElementById(id).srcObject = stream
    
}

const getLocalMediaStream = async ()=>{
    const stream = await navigator.mediaDevices.getUserMedia({video:true})
    const videoTrack = stream.getVideoTracks()[0]
    localStream = stream
    params = {
        ...params,
        track: videoTrack
    }

    console.log({params})



    // localVideo.srcObject = stream

    getRtpCapabilities()

    
}

const getRtpCapabilities = async ()=>{
    socket.emit('getRouterRtpCapabilities', (data)=>{
        console.log({data})
        rtpCapabilities = data;
        createDevice()
    })
}

const joinRoom = ()=>{
    socket.emit('joinRoom',{roomName},()=>{
        console.log('Room joined successfully')
        getLocalMediaStream()
    })
}

const createDevice = async ()=>{
    device = new mediasoupclient.Device()
    console.log(rtpCapabilities)
    await device.load({routerRtpCapabilities:rtpCapabilities})
    console.log({"canProduce": device.canProduce('video')})
    if(device.canProduce('video')){
        // createSendTransport()
        socket.emit('createWebRtcTransport',{consumer:false} ,async (remoteTransportParams)=>{
            console.log({remoteTransportParams})
            const {uuid, ...params} = remoteTransportParams
            const localTransport = await device.createSendTransport({...params,iceServers:[
                {'urls' : 'stun:stun1.l.google.com:19302'},
                {
                    urls: 'turn:relay1.expressturn.com:3478',
                    credential: 'xaQMSAhkufhl53NW',
                    username: 'efZDXAYWZO2KVVVJTS'
                }
            ]})
    
            localTransport.on("connect", async ({ dtlsParameters }, callback, errback) =>
                {
                  // Signal local DTLS parameters to the server side transport.

                  try
                  {
                    socket.emit("transport-connect", {
                        dtlsParameters,
                        uuid
                    });
                
                    // Tell the transport that parameters were transmitted.
                    callback();
                  }
                  catch (error)
                  {
                    // Tell the transport that something was wrong.
                    errback(error);
                  }
            });
                
            localTransport.on('produce', (data)=>{
                console.log('produce', {data})
                addElements('localVideo',localStream)
                socket.emit('transport-produce',{
                    kind: data.kind,
                    uuid,
                    rtpParameters: data.rtpParameters
                },(params)=>{
                    console.log("emit transport produce",{params})
                })
            })

            createSendTransport(localTransport)

        })
    }else{
        console.log("Ne peu produire une telle stream")
    }
}


const consumeProducersTracks = (producerId)=>{
    existingProducers.push(producerId)
    socket.emit('createWebRtcTransport',{consumer:true, producerId, rtpCapabilities:device.rtpCapabilities}, async (remoteTransportParams)=>{
        console.log("consumer",{remoteTransportParams})

        const {uuid, ...params}=remoteTransportParams

        console.log({uuid})

        // if(!remoteTransportParams.error){
            const consumerTransport = await device.createRecvTransport({...params,iceServers:[
                {'urls' : 'stun:stun1.l.google.com:19302'},
                {
                    urls: 'turn:relay1.expressturn.com:3478',
                    credential: 'xaQMSAhkufhl53NW',
                    username: 'efZDXAYWZO2KVVVJTS'
                }
            ]})

            createRecvTransport(consumerTransport,producerId,uuid, device.rtpCapabilities)

            consumerTransport.on('connect', async ({dtlsParameters}, callback, errback)=>{
                console.log({uuid})
                try {
                    await socket.emit('transport-recv-connect',{
                        producerId,
                        uuid,
                        dtlsParameters: dtlsParameters
                    })
                    callback()
                } catch (error) {
                    errback(error)
                }
            })
    
            
        // }else{
        //     console.log(remoteTransportParams.error)
        // }


    })
}


const createSendTransport = async (transport)=>{
    console.log({transport, params})
    try {
        const producer = await transport.produce(params)
    } catch (error) {
        console.log({error})
    }
}

const createRecvTransport =  (transport, remoteProducerId,uuid,rtpCapabilities)=>{
    socket.emit('consume',{
        producerId: remoteProducerId,
        uuid,
        rtpCapabilities
    }, async (params)=>{
        console.log({params})
        const consumer = await transport.consume({
            id: params.id,
            producerId: params.producerId,
            kind: params.kind,
            rtpParameters: params.rtpParameters
        })

        console.log(transport.id)
        socket.emit('consumer-resume',{consumerId:params.serverConsumerId},()=>{
            const {track} = consumer
            console.log({consumer, track})
    
            const media = new MediaStream([track])
    
            addElements(remoteProducerId,media)
        })


        // remoteVideo.srcObject=media
    })
}
init()