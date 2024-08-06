const express = require("express")
const {
    types,
    version,
    observer,
    createWorker,
    getSupportedRtpCapabilities,
    parseScalabilityMode
} = require("mediasoup");
const https = require("httpolyglot")
const { Server }= require("socket.io")
const { v4: uuidv4 } = require('uuid');
const fs = require("fs")
const path = require("path")

const app = express()
const options ={
    key:fs.readFileSync('./server/ssl/key.pem','utf-8'),
    cert:fs.readFileSync('./server/ssl/cert.pem','utf-8'),
}
const httpsServer = https.createServer(options, app)

const io = new Server(httpsServer)

const connections = io.of('/mediasoup')

let 
worker,
routers=[],
rooms = {},
peers ={}, 
transports = [], 
producers=[], 
consumers=[];

console.log({peers})

const createworker = async () => {
    worker = await createWorker({
      rtcMinPort: 10000,
      rtcMaxPort: 10200,
      logLevel : "warn",
        logTags  : [ "rtcp" ]
    })
    console.log(`worker pid ${worker.pid}`)
  
    worker.on('died', error => {
      console.error('mediasoup worker has died')
      setTimeout(() => process.exit(1), 2000) 
    })
  
    return worker
}
(async ()=>{
    worker = await createworker()
})()
  
observer.on("newworker", (worker) =>
    {
      console.log("new worker created [pid:%d]", worker.pid);
});

const routerOptions = {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000
      }
    ]
};


connections.on('connection', (socket)=>{
    // console.log({rooms})
    // console.log('New peer connected successfully', socket.id)
    // console.log('rooms',rooms)

    socket.on('disconnect',()=>{
        console.log('disconnect', rooms[peers[socket.id]?.roomName])
    })

    socket.on('joinRoom', ({roomName},callback)=>{
        // console.log(roomName)
        // console.log("all", rooms)
        
        // if(rooms[roomName]){
        //     rooms[roomName] = {
        //         participants: [...rooms[roomName].participants,socket.id],
        //         transports:[],
        //         consumers:[],
        //         routers:[],
        //         producers:[]
        //     }
        // }else{
        //     console.log('new one',rooms[roomName])
        //     // Initialize the room if it doesn't exist
        //     rooms[roomName] = {
        //         participants: [socket.id],
        //         transports: [],
        //         consumers: [],
        //         routers:[],
        //         producers: []
        //     };
        // }

        peers[socket.id] = {
            roomName
        }

        socket.join(roomName)

        // console.log({peers})

        socket.broadcast.to(roomName).emit('newuserjoined', `new user with socket id:${socket.id} joined the room`)

        callback()
    })

    socket.on('getProducers', (callback)=>{
        // on a besoin de consume uniquement les producer qui ne sont pas deja consumed
        callback({producers:producers.filter((el)=>el.participantId!==socket.id )})
    })

    socket.on('transport-recv-connect', async ({dtlsParameters,uuid, producerId})=>{
        // console.log("the end",{uuid})
        try{
            const {roomName} = peers[socket.id]
            const consumerTransport = getTransport(socket.id, uuid)
            // console.log('niceone all', {uuid})
            if(consumerTransport){
                // console.log('consume received')
                await consumerTransport.connect({ dtlsParameters })
                const producer = producers.filter((el)=>el.producerId ===producerId)

                producer[0].isConsumed = true

            }
        }catch(err){
            console.log({err})
        }
    })

    socket.on('consumer-resume',async ({consumerId},callback)=>{
        const {consumer} = consumers.filter(el=>el.consumerId === consumerId)[0]
        // console.log("top",{consumerId})

        await consumer.resume()

        callback()
    })

    socket.on('consume',async ({producerId,uuid, rtpCapabilities},callback)=>{
        const {roomName} = peers[socket.id]
        // console.log("for consumers",rooms[roomName].transports)
        const consumerTransport = getTransport(socket.id,uuid)
        try {
            const consumer = await consumerTransport.consume({
                producerId,
                rtpCapabilities,
                paused:true
            })
    
            consumers.push({participantId:socket.id,producerId,uuid,consumerId:consumer.id,consumer})
    
    
            callback({
                id:consumer.id,
                kind: consumer.kind,
                producerId,
                rtpParameters: consumer.rtpParameters,
                serverConsumerId: consumer.id
            })
            
        } catch (error) {
            console.log('Big error', error)
        }
    })

    socket.on('getRouterRtpCapabilities',async (callback)=>{
        const {roomName} = peers[socket.id]
        let roomRouter = routers.filter((el)=>el.roomName === roomName)?.pop()
        if(!roomRouter){
            console.log("damn")
            const router = await createRouter()
            routers.push({roomName, router})
            console.log({routers})
            roomRouter = routers.filter((el)=>el.roomName === roomName)?.pop()
        }else{
            // console.log('already exists', roomRouter)
        }

        roomRouter.router.observer.on("newtransport", (transport) =>
        {
            console.log("new transport created [id:%s]", transport.id);
        });

        callback(getRouterRtpCapabilities(roomRouter.router))
    })
    socket.on('transport-connect',  ({dtlsParameters, uuid})=>{
        getTransport(socket.id,uuid).connect({dtlsParameters})
    })

    socket.on('transport-produce', async ({kind,uuid, rtpParameters}, callback)=>{
        // console.log({kind,rtpParameters})
        const producer = await getTransport(socket.id,uuid).produce({
            kind,
            rtpParameters
        })

        const {roomName} = peers[socket.id]

        producers.push({participantId:socket.id,producerId:producer.id,isConsumed: false})

        // console.log("producers room",rooms[roomName].producers)

        producer.on('transportclose',()=>{
            console.log('Transport for this producer is closed')
            producer.close()
        })

        callback({
            id:producer.id
        })

        connections.in(roomName).emit('newproducer','new producer joined')
    })
    socket.on('createWebRtcTransport', async ({consumer, producerId, rtpCapabilities},callback)=>{
        console.log({consumer})
        let transport;
        let uuid = uuidv4()
        console.log("twice?",uuid)
        const webRtcServer = await worker.createWebRtcServer({
            listenInfos:[
                {
                    protocol : 'udp',
                    ip       : '0.0.0.0',
                    announcedAddress:null,
                    announcedIp:'127.0.0.1'
                },
                {
                    protocol : 'tcp',
                    ip       : '0.0.0.0',
                    announcedAddress:null,
                    announcedIp:'127.0.0.1'
                }
            ]
        })

        const {roomName} = peers[socket.id]

        const {router} = routers.filter((el)=>el.roomName == roomName)?.pop()

        if(consumer){ // ca signifie que c'est un producer
            if(router.canConsume({producerId, rtpCapabilities})){}
            else{
                callback({
                    params:{
                        error: "Can't consume"
                    }
                })

                return;
            }  
        }

        transport = await router.createWebRtcTransport({
            webRtcServer,
            enableTcp:true,
            enableUdp:true,
            preferUdp:true
        })

        console.log('transport previous', transports)
        if(consumer){
            transport.enableTraceEvent([ "rtp", "pli", "fir" ]);
        }

        transports.push({participantId:socket.id,transport,uuid, roomName,isConsumer:consumer})


        // console.log({roomstransport:transports.filter((el)=>el.roomName==roomName)})

        callback({
            id:transport.id,
            iceParameters:transport.iceParameters,
            uuid,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
            // sctpParameters: transport.sctpParameters
        })
        
    })

})

const createRouter = async ()=>{
    const router = await worker.createRouter(routerOptions)
    return router
}

const getTransport = (peerId,uuid=undefined)=>{
    const {roomName} = peers[peerId]
        const [{transport}] = transports.filter((el)=>el?.uuid === uuid)
        return transport;
}
const getRouterRtpCapabilities = (router)=>{
    return router.rtpCapabilities
}


app.get('*', (req,res,next)=>{
    const path = '/sfu/'
    if(req.path.indexOf(path) ===0 && req.path.length > path.length) return next()
    res.send("You need to specify room name ")
})

app.use('/sfu/:room',express.static((path.join(__dirname,'public'))))

httpsServer.listen(4000, ()=>{
    console.log("connected to port 4000")
})