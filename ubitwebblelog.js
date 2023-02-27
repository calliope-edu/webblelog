
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

const onDataTIMEOUT = 5000

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

class uBit extends EventTarget {
    constructor(manager) {
        super()

        // Identification data 
        this.id = null;
        this.label = null; 
        this.name = null;

        // Object ownership 
        this.manager = manager

        this.rawData = []
        this.rows = [] 
        this.timestamps = []
        this.dataLength = null

        this.onDataTimeoutHandler = null  // Also tracks if a read is in progress

        // Bind methods
        this.onConnect = this.onConnect.bind(this)
        this.onNewLength = this.onNewLength.bind(this)
        this.onSecurity = this.onSecurity.bind(this)

        this.disconnected = this.disconnected.bind(this)
        this.onData = this.onData.bind(this)
        this.onUsage = this.onUsage.bind(this)
        this.onDisconnect = this.onDisconnect.bind(this)

        this.retrieveChunk = this.retrieveChunk.bind(this)
        this.fullRead = this.fullRead.bind(this)
        this.disconnect = this.disconnect.bind(this)

        this.readLength = this.readLength.bind(this)
        
        this.onDataTimeout = this.onDataTimeout.bind(this)

        this.processData = this.processData.bind(this)


        // Connection state management setup 
        this.disconnected()
    }

    async readLength() {
        let length = await this.dataLen.readValue()
        let intLength = length.getUint32(0,true)
        return intLength        
    }

    async retrieveChunk(startIndex, length) {
        // Only works on byte index that is a multiple of 16. 

        if(startIndex%16!=0) {
            console.log(`Bad index: ${startIndex}`)
            return
        }
        // Limit length to end of buffer 
        length = Math.max(this.dataLength-startIndex, length)

        let dv = new DataView(new ArrayBuffer(8))
        dv.setUint32(0, startIndex, true)
        dv.setUint32(4, length, true)
        await this.dataReq.writeValue(dv)
        if(this.onDataTimeoutHandler!=null) {
            clearTimeout(this.onDataTimeoutHandler)
        }
        this.onDataTimeoutHandler = setTimeout(this.onDataTimeout, onDataTIMEOUT)
    }

    async fullRead() {
        this.retrieveChunk(0, this.dataLength)
    }


    async onConnect(service, chars, device) {
        // Add identity values if not already set (neither expected to change)
        this.id = this.id || device.id   
        this.name = this.name || device.name 

        // Bluetooth & connection configuration
        this.device = device 
        this.chars = chars 
        this.service = service

        this.chars.forEach(element => {
            let charName = serviceCharacteristics.get(element.uuid)
            if(charName!=null) {
                this[charName] = element
            } else {
                console.log(`Char not found: ${element.uuid}`)
            }
        });

        // Initial reads (need to be before notifies
        let time = await this.time.readValue() 
        let intTime = time.getBigUint64(0,true)

        this.mbConnectTime = intTime
        this.wallClockConnectTime = Date.now()

        this.dataLength = await this.readLength()

        // Connect / disconnect handlers
        this.manager.dispatchEvent(new CustomEvent("connected", {detail: this}))
    
        this.device.addEventListener('gattserverdisconnected', () => {
            this.onDisconnect()}, {once:true});

        // Subscribe to characteristics / notifications
        this.dataLen.addEventListener('characteristicvaluechanged', this.onNewLength)
        await this.dataLen.startNotifications()

        this.security.addEventListener('characteristicvaluechanged', this.onSecurity)
        await this.security.startNotifications()

        this.data.addEventListener('characteristicvaluechanged', this.onData)
        await this.data.startNotifications()

        this.usage.addEventListener('characteristicvaluechanged', this.onUsage)
        await this.usage.startNotifications()


        this.fullRead()
   }
   
    onNewLength(event) {
        // Updated length / new data
        let length = event.target.value.getUint32(0,true)
        let lastIndex = (this.rawData.length-1)*16
        // If there's new data, update
        if(this.dataLength != length) {
            this.dataLength = length;
            this.retrieveChunk(lastIndex, this.dataLength-lastIndex)
        }
    }

    onSecurity(event) {
        let value = event.target.value.getUint8()
        console.log(`Security: ${value}`)
    }

    processData() {
        let completeData = this.rawData.join('')
        console.log(`Complete data\n${completeData}`)
        /*
            Have an index and work backwards through "new" data
            Request any missing data
            If no missing data, process to rows and add timestamps
            Do callbacks to let interested parties know about new data (any data not already notified)
        */

    }

    onData(event) {
        // Stop any timer from running
        if(this.onDataTimeoutHandler!=null) {
            clearTimeout(this.onDataTimeoutHandler)
            this.onDataTimeoutHandler = null
        }

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
            this.rawData[index/16] = text
            // Not done:  Set the timeout
           this.onDataTimeoutHandler = setTimeout(this.onDataTimeout, onDataTIMEOUT)
        } else if(event.target.value.byteLength==0) {
            // Done: Do the check / processing / recovery (cancel timer)
            this.processData() 
        }
    }

    onDataTimeout() {
        // Stuff to do when onData is done
        console.log("onDataTimeout")
        this.onDataTimeoutHandler = null
        this.processData()
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

        this.mbConnectTime = null
        this.wallClockConnectTime = null

        if(this.onDataTimeoutHandler) {
            cancelTimeout(this.onDataTimeoutHandler)
            this.onDataTimeoutHandler = null
        }
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

            // Success!
            // TODO: Check for re-connect or initial connect
        } else {
            console.warn("No service found!")
        } 
    }

    getDevices() {
        return new Map(this.devices)
    }

}



