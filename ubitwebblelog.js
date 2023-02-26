
/*
 * JavaScript functions for interacting with micro:bit microcontrollers over WebBluetooth
 * (Only works in Chrome browsers;  Pages must be either HTTPS or local)
 */




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
    this.manager = manager
    this.completeData = ""
    this.disconnected()

    // Bind methods
    this.onData = this.onData.bind(this)
    this.onConnect = this.onConnect.bind(this)
    this.fullRead = this.fullRead.bind(this)
   }

   static textDecoder = new TextDecoder('utf-8');

   async onConnect(service, chars, device) {
    this.device = device 
    this.chars = chars 
    this.service = service
    console.dir(this.chars)
    this.chars.forEach(element => {
        let charName = serviceCharacteristics.get(element.uuid)
        if(charName!=null) {
            this[charName] = element
        } else {
            console.log(`Char not found: ${element.uuid}`)
        }
    });


    // Connect / disconnect handlers
    console.log(`onConnnect: ${this.manager}`)
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


    let time = await this.time.readValue() 
    console.log("Time:")
    let intTime = time.getBigUint64(0,true)
    console.log(`Time: ${intTime}`)
    console.dir(time)

    this.fullRead()
   }
   
   onNewLength(event) {
    // Updated length / new data
    let length = event.target.value.getUint32(0,true)
    console.log(`Length: ${length}`)
   }

   onSecurity(event) {
    let value = event.target.value.getUint8()
    console.log(`Security: ${value}`)
   }

 showHex(dv) {
    let str = ""
    for(let i=0; i<dv.byteLength; i++) {
        str += ` ${dv.getUint8(i).toString(16)}`
    }
     return str
   }



   onData(event) {
    // First four bytes are index/offset this is in reply to...

    console.log(`New  data!!! ${event}`)
    let dv = event.target.value

    if(dv.byteLength>=4) {
        let index = dv.getUint32(0,true)
        
        let text =''
        console.dir(dv)
        for(let i=4;i<dv.byteLength;i++) {
            let val = dv.getUint8(i)
            if(val!=0) {
                text += String.fromCharCode(val)
            }
        }

        console.log(`Text at ${index}: ${text}`)
        console.log(`Hex: ${this.showHex(dv)}`)

        this.completeData += text
    } else if(event.target.value.byteLength==0) {
        console.log("Done!")
        console.log(`Complete data\n${this.completeData}`)
    }

   }



   onUsage(event) {
    let value = event.target.value.getUint16(0, true)/10.0
    console.log(`New  usage  ${value}%`)
   }


   onDisconnect() {
    this.manager.dispatchEvent(new CustomEvent("disconnected", {detail: this} ));
    this.disconnected()
   }


   async fullRead() {
    // Get rid of existing data
    this.completeData = ""
    // Read all data
    console.log("Full read")
    let length = await this.dataLen.readValue()
    let intLength = length.getUint32(0,true)
    console.log(`Reading ${intLength}` )
    let dv = new DataView(new ArrayBuffer(8))
    dv.setUint32(0, 0, true)
    dv.setUint32(4, intLength, true)
    await this.dataReq.writeValue(dv)
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
   }
}

// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
// Testing / timing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}



const SERVICE_UUID     = "accb4ce4-8a4b-11ed-a1eb-0242ac120002"  // BLE Service
// const SECURITY_CHAR    = "accb4f64-8a4b-11ed-a1eb-0242ac120002"  // Security	Read, Notify
// const PASSPHRASE_CHAR  = "accb50a4-8a4b-11ed-a1eb-0242ac120002"  // Passphrase	Write
// const DATALEN_CHAR     = "accb520c-8a4b-11ed-a1eb-0242ac120002"  // Data Length	Read, Notify
// const DATA_CHAR        = "accb53ba-8a4b-11ed-a1eb-0242ac120002"  // Data	Notify
// const DATAREQ_CHAR     = "accb552c-8a4b-11ed-a1eb-0242ac120002"  // Data Request	Write
// const ERASE_CHAR       = "accb5946-8a4b-11ed-a1eb-0242ac120002"  // Erase	Write
// const USAGE_CHAR       = "accb5be4-8a4b-11ed-a1eb-0242ac120002"  // Usage	Read, Notify
// const TIME_CHAR        = "accb5dd8-8a4b-11ed-a1eb-0242ac120002"  // Time	Read

class uBitManager extends EventTarget  {

    constructor() {
        super()
        // Code
        // Map of devices
        this.devices = new Map()
    }

  

    /**
     * Connect to a device
     */
    async connect() {
        let device = await navigator.bluetooth.requestDevice({filters:[{namePrefix:"uBit"}], optionalServices: [SERVICE_UUID]});
        console.dir(device)
        let server = await device.gatt.connect()
        let services = await server.getPrimaryServices() 
        services = services.filter( u => u.uuid == SERVICE_UUID)
        if(services.length>0) {
            let service = services[0]
            let chars = await service.getCharacteristics()  
        
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
}



