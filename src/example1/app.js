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

const cors = require('cors');

const corsOptions = {
    origin: '*',
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

const options ={
    key:fs.readFileSync('./server/ssl/key.pem','utf-8'),
    cert:fs.readFileSync('./server/ssl/cert.pem','utf-8'),
}
const httpsServer = https.createServer(options, app)

const io = new Server(httpsServer,{
    cors: {
      origin: '*', // Allow specific origin
      methods: ['GET', 'POST'],
      credentials: true,
    },
  })

// const connections = io.of('/mediasoup')

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


io.on('connection', (socket)=>{
    // console.log({rooms})
    // console.log('New peer connected successfully', socket.id)
    // console.log('rooms',rooms)

    const removeItems = (items,type)=>{
        items.forEach((item)=>{
            if (item.participantId === socket.id) {
                item[type].close()
            }
        })
    
        items = items.filter(item => item.participantId !== socket.id)

        delete peers[socket.id]
    
        return items
    
    }

    socket.on('disconnect',()=>{
        console.log('disconnect', peers[socket.id]?.roomName)
        consumers = removeItems(consumers,'consumer')
        producers = removeItems(producers, 'producer')
        transports = removeItems(transports, 'transport')
    })

    socket.on('joinRoom', ({roomName},callback)=>{
        console.log("joined",roomName)
        
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
        console.log("Nombre de peers",{peersNumbers:peers})
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
            if(peers[socket.id]){
                const {roomName} = peers[socket.id]
                const consumerTransport = getTransport(socket.id, uuid)
                // console.log('niceone all', {uuid})
                if(consumerTransport){
                    // console.log('consume received')
                    await consumerTransport.connect({ dtlsParameters })
                    const producer = producers.filter((el)=>el.producerId ===producerId)
    
                    producer[0].isConsumed = true
    
                }
            }
        }catch(err){
            console.log({err})
        }
    })

    socket.on('consumer-resume',async ({consumerId},callback)=>{
        const consume = consumers.filter(el=>el.consumerId === consumerId)[0]

        if(consume?.consumer){
            const {consumer} = consume

            await consumer.resume()
    
            callback({
               consumer
            })

        }
        // console.log("top",{consumerId})

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

            consumer.on('transportclose', () => {
                console.log('transport close from consumer')
            })
      
            consumer.on('producerclose', () => {
                console.log('producer of consumer closed')
                console.log('peers', peers)
                socket.emit('producer-closed', { producerId })
            })

            consumer.on('producerpause', ()=>{
                console.log('producer of consumer paused')
                console.log('peers', peers)

                socket.emit('producer-paused', {producerId})
            })

            consumer.on('producerresume', async ()=>{
                console.log('producer of consumer resumed')
                console.log('peers', peers)
                console.log({producerId,  consumerTransport})
                const consumer = await consumerTransport.consume({
                    producerId,
                    rtpCapabilities,
                    paused:false
                })
    

                socket.emit('producer-resumed', {producerId, consumer})
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
        if(peers[socket.id]){
            const {roomName} = peers[socket.id]
            let roomRouter = routers.filter((el)=>el.roomName === roomName)?.pop()
            if(!roomRouter){
                // console.log("damn")
                const router = await createRouter()
                routers.push({roomName, router})
                console.log({routers})
                roomRouter = routers.filter((el)=>el.roomName === roomName)?.pop()
            }else{
                // console.log('already exists', roomRouter)
            }
    
            // roomRouter.router.observer.on("newtransport", (transport) =>
            // {
            //     console.log("new transport created [id:%s]", transport.id);
            // });
    
            callback(getRouterRtpCapabilities(roomRouter.router))
        }
    })
    socket.on('transport-connect',  ({dtlsParameters, uuid})=>{
        getTransport(socket.id,uuid)?.connect({dtlsParameters})
    })

    socket.on('producer-paused',({producerId},callback)=>{
        console.log({producerId})

        const producerToPaused = producers.find((el)=>el.producerId === producerId)
        // console.log({producerToPaused})
        if(producerToPaused){
            producerToPaused.producer.pause()
            callback({
                data: 'Producer found'
            })
        }
    })

    socket.on('producer-resumed',({producerId},callback)=>{
        console.log({producerId})

        const producerToPaused = producers.find((el)=>el.producerId === producerId)
        console.log({producerToPaused})
        if(producerToPaused){
            producerToPaused.producer.resume()
            callback({
                data: 'Producer found'
            })
        }
    })

    socket.on('transport-produce', async ({kind,uuid, rtpParameters}, callback)=>{
        // console.log({kind,rtpParameters})
        const producer = await getTransport(socket.id,uuid)?.produce({
            kind,
            rtpParameters
        })

        // console.log("test",peers[socket.id])
        // console.log('producer', producer)

        if(peers[socket.id]?.roomName){
            const {roomName} = peers[socket.id]
    
            producers.push({participantId:socket.id,producerId:producer?.id,producer,isConsumed: false})
    
            // console.log("producers room",rooms[roomName].producers)
            if(producer){
                producer.on('transportclose',()=>{
                    console.log('Transport for this producer is closed')
                    producer.close()
                })
                
                // console.log({producers,roomName})

                socket.broadcast.emit('newproducer',producers)
        
                // io.in(roomName).emit('newproducer','new producer joined')
                callback({
                    id:producer.id,
                    producers: producers?.filter((el)=>el?.participantId!==socket?.id)
                })
        
            }
    
        }

    })
    socket.on('createWebRtcTransport', async ({consumer, producerId, rtpCapabilities},callback)=>{
        // console.log({consumer})
        let transport;
        let uuid = uuidv4()
        // console.log("twice?",uuid)
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

        if(peers[socket.id]){
            const {roomName} = peers[socket.id]
    
            const roomRouter = routers.filter((el)=>el.roomName == roomName)?.pop()
            if(roomRouter.router){
                const {router} = roomRouter
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
        
                
                if(consumer){
                    transport.enableTraceEvent([ "rtp", "pli", "fir" ]);
                }
        
                transports.push({participantId:socket.id,transport,uuid, roomName,isConsumer:consumer})
                console.log('transport previous', transports)
                console.log('peers', peers)
        
                callback({
                    id:transport.id,
                    iceParameters:transport.iceParameters,
                    uuid,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                    // sctpParameters: transport.sctpParameters
                })
            }
        }


        
    })

})

const createRouter = async ()=>{
    if(worker){
        const router = await worker.createRouter(routerOptions)
        return router
    }
}

const getTransport = (peerId,uuid=undefined)=>{
    if(peers[peerId]){
        const {roomName} = peers[peerId]
        const res = transports.filter((el)=>el?.uuid === uuid)
        if(res[0]?.transport){
            return res[0]?.transport;
        }
    }
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