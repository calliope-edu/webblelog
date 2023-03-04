
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


// Thanks to https://stackoverflow.com/questions/21647928/javascript-unicode-string-to-hex
function convertToHex(str) {
    var hex = '';
    for(var i=0;i<str.length;i++) {
        hex += ''+str.charCodeAt(i).toString(16);
    }
    return hex;
}

function download(data, filename, type) {
    var file = new Blob([data], {type: type});
    if (window.navigator.msSaveOrOpenBlob) // IE10+
        window.navigator.msSaveOrOpenBlob(file, filename);
    else { // Others
        var a = document.createElement("a"),
                url = URL.createObjectURL(file);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function() {
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);  
        }, 0); 
    }
}


// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
// Testing / timing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const onDataTIMEOUT = 1000
const dataBurstSIZE = 100
const progressPacketThreshold = 10  // More than 10 packets and report progress of transfer


const SERVICE_UUID     = "accb4ce4-8a4b-11ed-a1eb-0242ac120002"  // BLE Service
const serviceCharacteristics = new Map( 
    [
     ["accb4f64-8a4b-11ed-a1eb-0242ac120002", "security"],    // Security	Read, Notify
     ["accb50a4-8a4b-11ed-a1eb-0242ac120002", "passphrase"],  // Passphrase	Write
     ["accb520c-8a4b-11ed-a1eb-0242ac120002", "dataLen"],     // Data Length	Read, Notify
     ["accb53ba-8a4b-11ed-a1eb-0242ac120002", "data"],        // Data	Notify
     ["accb552c-8a4b-11ed-a1eb-0242ac120002", "dataReq"],     // Data Request	Write
     ["accb5946-8a4b-11ed-a1eb-0242ac120002", "erase"],       // Erase	Write
     ["accb5be4-8a4b-11ed-a1eb-0242ac120002", "usage"],       // Usage	Read, Notify
     ["accb5dd8-8a4b-11ed-a1eb-0242ac120002", "time"]         // Time	Read
    ]);


/*
Class to track the state of data retrievals 
*/ 
class retrieveTask {
    /**
     * 
     * @param {*} start 16-byte aligned start index (actual data index is "start*16")
     * @param {*} length Number of 16-byte segments to retrieve 
     * @param {*} progress Progress of the task (0-100) at the start of this bundle or null (-1) if not shown
     * @param {*} final indicator of final bundle for request
     * @param {*} success Callback function for success (completion)
     */
    constructor(start, length, progress = -1, final, success = null) {
        this.start = start    // Start index of the data
        this.segments = new Array(length) // Segment data 
        this.processed = 0   // Number of segments processed
        this.progress = progress
        this.final = final 
        this.success = success
    }
}

class uBit extends EventTarget {
    constructor(manager) {
        super()

        // Device Identification data 
        this.id = null;
        this.label = null; 
        this.name = null;

        // Authentication data
        this.password = null
        this.passwordAttempts = 0

        // Object ownership 
        this.manager = manager

        // "CSV" raw packets and overall length of data on device
        this.rawData = []
        this.dataLength = null

        // Managing Data retrieval 
        this.onDataTimeoutHandler = -1  // Also tracks if a read is in progress
        this.retrieveQueue = []


        // Parsing data
        this.bytesProcessed = 0
        this.nextDataAfterReboot = false
        this.headers = []
        this.indexOfTime = 0
        this.rows = [] 
        this.timestamps = []

        // Connection Management
        this.firstConnectionUpdate = false


        // Bind Callback methods
        this.onConnect = this.onConnect.bind(this)
        this.onNewLength = this.onNewLength.bind(this)
        this.onSecurity = this.onSecurity.bind(this)
        this.onData = this.onData.bind(this)
        this.onUsage = this.onUsage.bind(this)
        this.onDisconnect = this.onDisconnect.bind(this)


        this.disconnected = this.disconnected.bind(this)

        this.retrieveChunk = this.retrieveChunk.bind(this)
        this.disconnect = this.disconnect.bind(this)

        this.readLength = this.readLength.bind(this)
        this.notifyDataProgress = this.notifyDataProgress.bind(this)

        this.checkChunk = this.checkChunk.bind(this)
        this.processChunk = this.processChunk.bind(this)
        this.requestSegment = this.requestSegment.bind(this)

        this.clearDataTimeout = this.clearDataTimeout.bind(this)
        this.setDataTimeout = this.setDataTimeout.bind(this)
        this.onDataTimeout = this.onDataTimeout.bind(this)
        this.onAuthorized = this.onAuthorized.bind(this)
        
        this.download = this.download.bind(this)
        this.parseData = this.parseData.bind(this)
        this.startNextRetrieve = this.startNextRetrieve.bind(this)

        this.onConnectionSyncCompleted = this.onConnectionSyncCompleted.bind(this)
        // Connection state management setup 
        this.disconnected()
    }

    download(filename) {
        let completeData = this.rawData.join('')

        download(completeData, filename, "csv")
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
        if(this.onDataTimeoutHandler!=-1) {
            console.log("onDataTimeout")
            this.clearDataTimeout()
            this.checkChunk() 
        } 
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
        // console.log(`requestSegment: Requesting @ ${start} ${length} *16 bytes`)
        if(this.device && this.device.gatt && this.device.gatt.connected) {
            let dv = new DataView(new ArrayBuffer(8))
            dv.setUint32(0, start*16, true)
            dv.setUint32(4, length*16, true)
            await this.dataReq.writeValue(dv)
            this.clearDataTimeout()
            this.setDataTimeout()    
        }
    }

    notifyDataProgress(progress) {
        this.manager.dispatchEvent(new CustomEvent("progress", {detail: {device:this, progress:progress}}))
    }


    /**
     * Retrieve a range of data and re-request until it's all delivered.
     * Assuming to be non-overlapping calls.  I.e. this won't be called again until all data is delivered
     * @param {*} start 16-byte aligned start index (actual data index is "start*16")
     * @param {*} length Number of 16-byte segments to retrieve
     * @returns 
     */
    async retrieveChunk(start, length, success = null) {
        console.log(`retrieveChunk: Retrieving @${start} ${length} *16 bytes`)
        if(start*16>this.dataLength) {
            console.log(`retrieveChunk: Start index ${start} is beyond end of data`)
            return
        }  


        if(start + length > Math.ceil(this.dataLength/16)) {  
            console.log(`retrieveChunk: Requested data extends beyond end of data`)
           // return
        }  

        // Break it down into smaller units if needed
        let noPending = this.retrieveQueue.length == 0
        let progressIndicator = length>progressPacketThreshold
        let numBursts = Math.ceil(length / dataBurstSIZE)
        let remainingData = length
        let thisRequest = 0
        while(remainingData > 0) {
            let thisLength = Math.min(remainingData, dataBurstSIZE)
            let finalRequest = thisRequest == numBursts-1
            let newTask = new retrieveTask(start, 
                                            thisLength, 
                                            progressIndicator ? Math.floor(thisRequest/numBursts*100) : -1, 
                                            finalRequest, 
                                            finalRequest ? success : null)
            this.retrieveQueue.push(newTask)
            start += thisLength
            remainingData -= thisLength
            thisRequest++
        }

        // If nothing is being processed now, start it
        if(noPending) {
            this.startNextRetrieve()
        }
    }

    async onConnect(service, chars, device) {
        // Add identity values if not already set (neither expected to change)
        this.id = this.id || device.id   
        this.name = this.name || device.name 


        // Bluetooth & connection configuration
        this.device = device 
        this.chars = chars 
        this.service = service
        this.passwordAttempts = 0
        this.nextDataAfterReboot = false
        this.firstConnectionUpdate = true

        this.chars.forEach(element => {
            let charName = serviceCharacteristics.get(element.uuid)
            if(charName!=null) {
                this[charName] = element
            } else {
                console.log(`Char not found: ${element.uuid}`)
            }
        });

        // Connect / disconnect handlers
        this.manager.dispatchEvent(new CustomEvent("connected", {detail: this}))

        this.device.addEventListener('gattserverdisconnected', () => {
            this.onDisconnect()}, {once:true});

        this.security.addEventListener('characteristicvaluechanged', this.onSecurity)
        await this.security.startNotifications()
    }
   

    async onAuthorized() {
        // Subscribe to characteristics / notifications
        // Initial reads (need to be before notifies
        let time = await this.time.readValue() 
        let intTime = time.getBigUint64(0,true)

        this.mbConnectTime = intTime
        this.wallClockConnectTime = Date.now()

        this.data.addEventListener('characteristicvaluechanged', this.onData)
        await this.data.startNotifications()

        this.usage.addEventListener('characteristicvaluechanged', this.onUsage)
        await this.usage.startNotifications()

        // Enabling notifications will get current length;
        // Getting current length will retrieve all "new" data since last retrieve
        this.dataLen.addEventListener('characteristicvaluechanged', this.onNewLength)
        await this.dataLen.startNotifications()        
    }
       

    onNewLength(event) {
        // Updated length / new data
        let length = event.target.value.getUint32(0,true)
        console.log(`New Length: ${length} (was ${this.dataLength})`)

        // If there's new data, update
        if(this.dataLength != length) {

            // Probably erased.  Retrieve it all
            if(length<this.dataLength) {
                console.log("Log smaller than expected.  Retrieving all data")
                this.rawData = []
                this.dataLength = 0
                this.bytesProcessed = 0 // Reset to beginning of processing
                this.discardRetrieveQueue() // Clear any pending requests
                this.manager.dispatchEvent(new CustomEvent("graph cleared", {detail: this}))
            }

            // Get the index of the last known value (since last update)
            // floor(n/16) = index of last full segment 
            // ceil(n/16) = index of last segment total (or count of total segments)
            let lastIndex = Math.floor(this.dataLength/16)  // Index of first non-full segment
            let totalSegments = Math.ceil(length/16) // Total segments _now_
            this.dataLength = length;
            // Retrieve checks dataLength;  Must update it first;  
            this.retrieveChunk(lastIndex, 
                                totalSegments-lastIndex, 
                                this.firstConnectionUpdate ? this.onConnectionSyncCompleted : null)
            this.firstConnectionUpdate = false
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



    // TODO
    parseData() {
        console.log("parseData")
        return 
        let index = Math.floor(this.bytesProcessed/16)
        let offset = this.bytesProcessed%16
        let data = ""
        let newLineLocation = -1

        while(index<this.rawData.length && newLineLocation<0) {
            let newPacket = this.rawData[index]
            newLineLocation = newPacket.indexOf("\n")
            data = data+newPacket.substring(offset, newLineLocation>=0?newLineLocation:16)
            offset = 0 
            index++
        }
        if(newLineLocation>=0) {
            console.log(`New data: ${data}`)
            this.bytesProcessed += data.length
            if(data=="Reboot") {
                this.nextDataAfterReboot = true
            } else {
                // Parse out the data / headers
                if(data.includes("Time")) {
                    this.headers = data.split(",")
                    for(let i=0;i<this.headers.length;i++) {
                        if(this.headers[i].includes("Time")) {
                            this.indexOfTime = i
                            break;
                        }
                    }
                    console.log(`Headers: ${this.headers}`)
                } else {
                    // DATA!
                    let values = data.split(",")
                    console.log(`Values: ${values}`)
                    let uBTime = values[this.indexOfTime]
                    let before = values.slice(0, this.indexOfTime)
                    let after = values.slice(this.indexOfTime+1)

                    this.rows += [this.nextDataAfterReboot,null].concat([uBTime]).concat(before).concat(after)
                }
                // Do notifications
            }
        }

    }

    onSecurity(event) {
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
    }

    startNextRetrieve() {
        // If there's another one queued up, start it
        if(this.retrieveQueue.length>0) {
            // Request the next chunk
            let nextRetrieve = this.retrieveQueue[0]
            this.requestSegment(nextRetrieve.start, nextRetrieve.segments.length)
            // Post the progress of the next transaction
            if(nextRetrieve.progress>=0) {
                this.notifyDataProgress(nextRetrieve.progress)
            }
        } 
    }

    onConnectionSyncCompleted() {
        console.log("onConnectionSyncCompleted")
    }

    processChunk(retrieve) {
        // If final packet and we care about progress, send completion notification
        // console.log(`processChunk: ${retrieve.progress} ${retrieve.final} ${retrieve.success} ${retrieve.segments.length}`)
        if(retrieve.progress>=0 && retrieve.final) {
            this.notifyDataProgress(100)
        }

        // Pop off the retrieval task
        this.retrieveQueue.shift()

        // Start the next one (if any)
        this.startNextRetrieve()

        // Copy data from this to raw data  
        for(let i=0;i<retrieve.segments.length;i++) {
            if(retrieve.segments[i]==null) {
                console.log(`ERROR: Null segment: ${i}`)
            }
            this.rawData[retrieve.start+i] = retrieve.segments[i]
        }

        // If we're done with the entire transaction, call the completion handler if one
        if(retrieve.success) {
            retrieve.success()
        }
    }

    checkChunk() {
        // console.log("checkChunk")
        if(this.retrieveQueue.length==0) {
            console.log('No retrieve queue')
            return
        }
        let retrieve = this.retrieveQueue[0]

        // If done
        if(retrieve.processed==retrieve.segments.length) {
            this.processChunk(retrieve)
        } else {
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
                // No missing segments. Process it
                this.processChunk(retrieve)
            }
        }
    }

    onData(event) {
        // Stop any timer from running
        this.clearDataTimeout()
        // If we're not trying to get data, ignore it
        if(this.retrieveQueue.length==0) {
            return;
        }
        // First four bytes are index/offset this is in reply to...
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

            let retrieve = this.retrieveQueue[0]

// if(Math.random()<.01) {
//     console.log("Dropped Packet")
// } else {

            // console.dir(retrieve)
            let segmentIndex = (index/16 - retrieve.start);
            // console.log(`Index: ${index} Start: ${retrieve.start}  index: ${segmentIndex}`)
            if(segmentIndex == retrieve.processed)
                retrieve.processed++

            if(retrieve.segments[segmentIndex]!=null) {
                console.log(`ERROR:  Segment already set ${segmentIndex}: "${retrieve.segments[segmentIndex]}" "${text}" `)
                if(retrieve.segments[segmentIndex].length!=text.length && retrieve.segments[segmentIndex]!=text) {
                    console.log("Segment is ok (duplicate / overlap")
                } else {
                    console.log("Duplicate segment")
                }
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
            this.checkChunk() 
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
        this.manager.dispatchEvent(new CustomEvent("log usage", {detail: {device: this, percent: value}} ))
    }

    onDisconnect() {
        this.device.gatt.disconnect()
        this.disconnected()
        this.manager.dispatchEvent(new CustomEvent("disconnected", {detail: this} ))
    }

    discardRetrieveQueue() {
        if(this.retrieveQueue.length>0 && this.retrieveQueue[0].progress>=0) {
            this.notifyDataProgress(100)
        }
        while(this.retrieveQueue.pop()) {}
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
        // Update data to reflect what we actually have
        this.dataLength = Math.max(0, (this.rawData.length-1)*16)

        this.discardRetrieveQueue()

        this.mbConnectTime = null
        this.wallClockConnectTime = null
        this.clearDataTimeout()
    }

    disconnect() {
        if(this.device && this.device.gatt && this.device.gatt.connected) {
            this.device.gatt.disconnect()
        }
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



