
/*
 * JavaScript functions for interacting with micro:bit microcontrollers over WebBluetooth
 * (Only works in Chrome browsers;  Pages must be either HTTPS or local)
 */

// Debugging / Private 
function showHex(dv) {
    let str = ""
    for(let i=0; i<dv.byteLength; i++) {
        str += ` ${dv.getUint8(i).toString(16)}`
    }
    return str
}

// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
// Testing / timing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const onDataTIMEOUT = 500
const dataBurstSIZE = 100
const progressPacketThreshold = 10  // More than 10 packets and report progress of transfer


const SERVICE_UUID     = "accb4ce4-8a4b-11ed-a1eb-0242ac120002"  // BLE Service
const serviceCharacteristics = new Map( 
    [
     ["accb4f64-8a4b-11ed-a1eb-0242ac120002", "security"],  // Security	Read, Notify
     ["accb50a4-8a4b-11ed-a1eb-0242ac120002", "passphrase"],  // Passphrase	Write
     ["accb520c-8a4b-11ed-a1eb-0242ac120002", "dataLen"],   // Data Length	Read, Notify
     ["accb53ba-8a4b-11ed-a1eb-0242ac120002", "data"],      // Data	Notify
     ["accb552c-8a4b-11ed-a1eb-0242ac120002", "dataReq"],   // Data Request	Write
     ["accb5946-8a4b-11ed-a1eb-0242ac120002", "erase"],     // Erase	Write
     ["accb5be4-8a4b-11ed-a1eb-0242ac120002", "usage"],     // Usage	Read, Notify
     ["accb5dd8-8a4b-11ed-a1eb-0242ac120002", "time"]       // Time	Read
    ]);


/*
Class to track the state of data retrievals 
*/ 
class retrieveTask {
    /**
     * 
     * @param {*} start 16-byte aligned start index (actual data index is "start*16")
     * @param {*} length Number of 16-byte segments to retrieve 
     */
    constructor(start, length) {
        this.start = start    // Start index of the data
        this.segments = new Array(length) // Segment data 
        this.processed = 0   // Number of segments processed
        // console.log("New retrieve task: ")
        // console.dir(this)
    }
}

class uBit extends EventTarget {
    constructor(manager) {
        super()

        // Identification data 
        this.id = null;
        this.label = null; 
        this.name = null;
        this.password = null
        this.passwordAttempts = 0
        // Object ownership 
        this.manager = manager

        this.rawData = []
        this.rows = [] 
        this.timestamps = []
        this.dataLength = null

        this.onDataTimeoutHandler = -1  // Also tracks if a read is in progress
        this.retrieveQueue = []
        this.progressTotal = -1


        // Bind methods
        this.onConnect = this.onConnect.bind(this)
        this.onNewLength = this.onNewLength.bind(this)
        this.onSecurity = this.onSecurity.bind(this)

        this.disconnected = this.disconnected.bind(this)
        this.onData = this.onData.bind(this)
        this.onUsage = this.onUsage.bind(this)
        this.onDisconnect = this.onDisconnect.bind(this)

        this.retrieveChunk = this.retrieveChunk.bind(this)
        this.disconnect = this.disconnect.bind(this)

        this.readLength = this.readLength.bind(this)
        

        this.processChunk = this.processChunk.bind(this)
        this.requestSegment = this.requestSegment.bind(this)

        this.clearDataTimeout = this.clearDataTimeout.bind(this)
        this.setDataTimeout = this.setDataTimeout.bind(this)
        this.onDataTimeout = this.onDataTimeout.bind(this)
        this.onAuthorized = this.onAuthorized.bind(this)
        
        // Connection state management setup 
        this.disconnected()
    }

    clearDataTimeout() {
        // console.log(`clearDataTimeout: handler ID ${this.onDataTimeoutHandler}`)
        if(this.onDataTimeoutHandler!=-1) {
            clearTimeout(this.onDataTimeoutHandler)
            this.onDataTimeoutHandler = -1
        }
    }

    setDataTimeout() {
        this.clearDataTimeout()
        this.onDataTimeoutHandler = setTimeout(this.onDataTimeout, onDataTIMEOUT)
        // console.log(`setDataTimeout: handler ID ${this.onDataTimeoutHandler}`)
    }

    onDataTimeout() {
        // Stuff to do when onData is done
        // console.log("onDataTimeout")
        if(this.onDataTimeoutHandler!=-1) {
            this.clearDataTimeout()
            this.processChunk() 
        } 
        // else {
        //     console.log("onDataTimeout: Not needed")
        // }
    }

    async readLength() {
        let length = await this.dataLen.readValue()
        let intLength = length.getUint32(0,true)
        return intLength        
    }

    /*
      Request a chunk of data (for subset of full retrieve process)
    */
    async requestSegment(start, length) {
        console.log(`requestSegment: Requesting @ ${start} ${length} *16 bytes`)
        if(this.device && this.device.gatt && this.device.gatt.connected) {
            let dv = new DataView(new ArrayBuffer(8))
            dv.setUint32(0, start*16, true)
            dv.setUint32(4, length*16, true)
            await this.dataReq.writeValue(dv)
            this.clearDataTimeout()
            this.setDataTimeout()    
        }
    }



    /**
     * Retrieve a range of data and re-request until it's all delivered.
     * Assuming to be non-overlapping calls.  I.e. this won't be called again until all data is delivered
     * @param {*} start 16-byte aligned start index (actual data index is "start*16")
     * @param {*} length Number of 16-byte segments to retrieve
     * @returns 
     */
    async retrieveChunk(start, length) {
        // console.log(`retrieveChunk: Retrieving @${start} ${length} *16 bytes`)
        if(start*16>this.dataLength) {
            console.log(`retrieveChunk: Start index ${start} is beyond end of data`)
            return
        }  

        // Update progress if this is a significant request
        if(length>progressPacketThreshold) {
            // console.log("retrieveChunk: Progress update")
            this.progressTotal = length
            this.manager.dispatchEvent(new CustomEvent("progress", {detail: {device:this, progress:0}}))
        } else {
            this.progressTotal = -1
        }

        if(start + length > Math.ceil(this.dataLength/16)) {  
            console.log(`retrieveChunk: Requested data extends beyond end of data`)
           // return
        }  

        let startNew = this.retrieveQueue.length == 0

        // Break it down into smaller units
        let remainingData = length
        while(remainingData > 0) {
            let thisLength = Math.min(remainingData, dataBurstSIZE)
            this.retrieveQueue.push(new retrieveTask(start, thisLength))    
            start += thisLength
            remainingData -= thisLength
        }

        // If nothing is being processed now, start it
        if(startNew) {
            this.requestSegment(this.retrieveQueue[0].start, this.retrieveQueue[0].segments.length)
        }
    }

    async onConnect(service, chars, device) {
        console.log("onConnect")
        // Add identity values if not already set (neither expected to change)
        this.id = this.id || device.id   
        this.name = this.name || device.name 

        // Bluetooth & connection configuration
        this.device = device 
        this.chars = chars 
        this.service = service
        this.passwordAttempts = 0
        this.chars.forEach(element => {
            let charName = serviceCharacteristics.get(element.uuid)
            if(charName!=null) {
                this[charName] = element
            } else {
                console.log(`Char not found: ${element.uuid}`)
            }
        });

        console.log("connected")

        // Connect / disconnect handlers
        this.manager.dispatchEvent(new CustomEvent("connected", {detail: this}))

        console.log("setting disconnect handler")

        this.device.addEventListener('gattserverdisconnected', () => {
            this.onDisconnect()}, {once:true});

        console.log("setting security handler")

        this.security.addEventListener('characteristicvaluechanged', this.onSecurity)
        await this.security.startNotifications()
    }
   

    async onAuthorized() {
        console.log("onAuthorized")
        // Subscribe to characteristics / notifications
        // Initial reads (need to be before notifies
        let time = await this.time.readValue() 
        let intTime = time.getBigUint64(0,true)

        this.mbConnectTime = intTime
        this.wallClockConnectTime = Date.now()

        this.dataLength = await this.readLength()

        this.dataLen.addEventListener('characteristicvaluechanged', this.onNewLength)
        await this.dataLen.startNotifications()

        this.data.addEventListener('characteristicvaluechanged', this.onData)
        await this.data.startNotifications()

        this.usage.addEventListener('characteristicvaluechanged', this.onUsage)
        await this.usage.startNotifications()

        this.retrieveChunk(0, Math.ceil(this.dataLength/16))
    }
       

    onNewLength(event) {
        // Updated length / new data
        let length = event.target.value.getUint32(0,true)
        console.log(`New Length: ${length} (was ${this.dataLength})`)

        // If there's new data, update
        if(this.dataLength != length) {

            // TODO:  IF length == 0, erase all data stored (log erased)


            // Get the index of the last known value (since last update)
            // floor(n/16) = index of last full segment 
            // ceil(n/16) = index of last segment total (or count of total segments)
            let lastIndex = Math.floor(this.dataLength/16)  // Index of first non-full segment
            let totalSegments = Math.ceil(length/16) // Total segments _now_
            this.dataLength = length;
            // Retrieve checks dataLength;  Must update it first
            this.retrieveChunk(lastIndex, totalSegments-lastIndex)
        }
    }

    sendErase() {
        console.log(`sendErase`)
        if(this.device && this.device.gatt && this.device.gatt.connected) {
            let dv = new DataView(new ArrayBuffer(5))
            let i = 0
            for(let c of "ERASE") {
                dv.setUint8(i++, c.charCodeAt(0))
            }
            this.erase.writeValue(dv)
        }
    }

    sendAuthorization(password) {
        console.log(`sendAuthorization: ${password}`)
        if(this.device && this.device.gatt && this.device.gatt.connected) {
            let dv = new DataView(new ArrayBuffer(password.length))
            let i = 0
            for(let c of password) {
                dv.setUint8(i++, c.charCodeAt(0))
            }
            this.passphrase.writeValue(dv)
            this.password = password
        }
    }

    onSecurity(event) {
        console.log(`onSecurity`)

        let value = event.target.value.getUint8()
        if(value!=0) {
            this.onAuthorized()
        } else {
            if(this.password!=null && this.passwordAttempts==0) {
                // If we're on the first connect and we have a stored password, try it
                this.sendAuthorization(this.password)
                this.passwordAttempts++
            } else {
                // Need a password or password didn't work
                this.manager.dispatchEvent(new CustomEvent("unauthorized", {detail: this}))
            }
        }
        console.log(`Security: ${value}`)
    }

    processChunk() {
        // console.log("processChunk")
        if(this.retrieveQueue.length==0) {
            console.log('No retrieve queue')
            return
        }
        let retrieve = this.retrieveQueue[0]
        // console.dir(retrieve)

        // If done
        if(retrieve.processed==retrieve.segments.length) {
            // Pop off the retrieval task
            this.retrieveQueue.shift()
            // If there's another one queued up, start it
            if(this.retrieveQueue.length>0) {
                // Request the next chunk
                let nextRetrieve = this.retrieveQueue[0]
                this.requestSegment(nextRetrieve.start, nextRetrieve.segments.length)
                if(this.progressTotal>0) {
                    let remaining = this.retrieveQueue.reduce((a,b) => a+b.segments.length, 0)
                    let percent = Math.max(0, Math.min(100, Math.round(100*(1-remaining/this.progressTotal))))
                    this.manager.dispatchEvent(new CustomEvent("progress", {detail: {device:this, progress:percent}}))
                }
            } else {
                console.log("Task Queue empty")
                if(this.progressTotal>0) {
                    this.progressTotal = -1
                    this.manager.dispatchEvent(new CustomEvent("progress", {detail: {device:this, progress:100}}))
                }
            }

            // Copy data to raw data  
            for(let i=0;i<retrieve.segments.length;i++) {
                if(retrieve.segments[i]==null) {
                    console.log(`ERROR: Null segment: ${i}`)
                }
                // TODO: Check to see if replaying or not
                this.rawData[retrieve.start+i] = retrieve.segments[i]
            }
            // Process it... 
            let completeData = this.rawData.join('')
            console.log(`Complete data\n${completeData}`)

        } else {
            // Iterate through completed segments
            // console.log('Missing packets')
            // console.dir(retrieve)

            // Advance to next missing packet
            while(retrieve.processed<retrieve.segments.length && retrieve.segments[retrieve.processed]!=null) {
                retrieve.processed = retrieve.processed+1
            }
            // If there's a non-set segment, request it
            if(retrieve.processed<retrieve.segments.length) {
                // Identify the run length of the missing piece(s)
                let length = 1;
                while(retrieve.processed+length<retrieve.segments.length &&
                    retrieve.segments[retrieve.processed+length]==null ) {
                    length++
                }
                // Request them
                this.requestSegment(retrieve.start+retrieve.processed, length)
            } else {
                // Done:  Process it
                console.log('Done: Process it')
                // Call this function again (but not recursively)
                setTimeout(this.processChunk, 0)
            }
        }
    }

    onData(event) {
        // Stop any timer from running
        this.clearDataTimeout()

        // First four bytes are index/offset this is in reply to...
        // console.log(`New  data!!! ${event}`)
        let dv = event.target.value

        if(dv.byteLength>=4) {
            let index = dv.getUint32(0,true)
            
            let text =''
            for(let i=4;i<dv.byteLength;i++) {
                let val = dv.getUint8(i)
                if(val!=0) {
                    text += String.fromCharCode(val)
                }
            }

            // console.log(`Text at ${index}: ${text}`)
            // console.log(`Hex: ${showHex(dv)}`)

            // Use packet index, which is byte index/16
            
            let retrieve = this.retrieveQueue[0]

// if(Math.random()<.01) {
//     console.log("Dropped Packet")
// } else {

            // console.dir(retrieve)
            let segmentIndex = (index/16 - retrieve.start);
            //console.log(`Index: ${index} Start: ${retrieve.start}  index: ${segmentIndex}`)
            if(segmentIndex == retrieve.processed)
                retrieve.processed++

            if(retrieve.segments[segmentIndex]!=null) {
                console.log(`ERROR:  Segment already set ${segmentIndex}`)
                console.log(retrieve.segments[segmentIndex])
                console.log(text)
            }
            if(segmentIndex>=0 && segmentIndex<retrieve.segments.length) {
                retrieve.segments[segmentIndex] = text
            } else {
                console.log(`ERROR:  Segment out of range ${segmentIndex} (max ${retrieve.segments.length}`)
            }
//  }  // END Dropped packet test
            // Not done:  Set the timeout
            this.setDataTimeout()
        } else if(event.target.value.byteLength==0) {
            // Done: Do the check / processing (timer already cancelled)
            // console.log("Terminal packet.")
// if(Math.random()<.10) {
            this.processChunk() 
// } else {
//     // Simulate timeout
//     console.log("Dropped terminal packet")
//     this.setDataTimeout()
// }

        } else {
            console.log(`ERROR:  Unexpected data length ${event.target.value.byteLength}`)
        }
    }



    onUsage(event) {
        let value = event.target.value.getUint16(0, true)/10.0
        console.log(`New usage  ${value}%`)
    }

    onDisconnect() {
        this.manager.dispatchEvent(new CustomEvent("disconnected", {detail: this} ))
        this.device.gatt.disconnect()
        this.disconnected()
    }

    disconnected() {
        this.device = null
        this.service = null
        this.chars = null
        this.security = null
        this.passphrase = null 
        this.dataLen = null 
        this.data = null 
        this.dataReq = null
        this.erase = null 
        this.usage = null
        this.time = null

        this.retrieveQueue = []

        this.mbConnectTime = null
        this.wallClockConnectTime = null
        this.clearDataTimeout()

        this.progressTotal = -1
    }

    disconnect() {
        this.device.gatt.disconnect()
    }
}





class uBitManager extends EventTarget  {

    constructor() {
        super()

        // Map of devices
        this.devices = new Map()

        this.connect = this.connect.bind(this)
    }

    /**
     * Connect to a device
     */
    async connect() {
        let device = await navigator.bluetooth.requestDevice({filters:[{namePrefix:"uBit"}], optionalServices: [SERVICE_UUID]});
        let server = await device.gatt.connect()
        let services = await server.getPrimaryServices() 
        services = services.filter( u => u.uuid == SERVICE_UUID)
        if(services.length>0) {
            let service = services[0]
            let chars = await service.getCharacteristics()  
            // Add or update the device
            let uB = this.devices.get(device.id)
            if(!uB){
                uB = new uBit(this)
                this.devices.set(device.id, uB)
            }
            await uB.onConnect(service, chars, device)
        } else {
            await uB.devices.gatt.disconnect()
            this.manager.dispatchEvent("no blelog services")

            console.warn("No service found!")
        } 
    }

    getDevices() {
        return new Map(this.devices)
    }

}



