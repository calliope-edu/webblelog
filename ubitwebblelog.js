
/*
 * JavaScript functions for interacting with micro:bit microcontrollers over WebBluetooth
 * (Only works in Chrome browsers;  Pages must be either HTTPS or local)
 */

class uBit extends EventTarget {
   constructor(device, service, chars) {
    super()
    this.device = device
    this.service = service
    this.chars = chars
   }
}

// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
// Testing / timing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
const SERVICE_UUID     = "accb4ce4-8a4b-11ed-a1eb-0242ac120002"  // BLE Service
const SECURITY_CHAR    = "accb4f64-8a4b-11ed-a1eb-0242ac120002"  // Security	Read, Notify
const PASSPHRASE_CHAR  = "accb50a4-8a4b-11ed-a1eb-0242ac120002"  // Passphrase	Write
const DATALEN_CHAR     = "accb520c-8a4b-11ed-a1eb-0242ac120002"  // Data Length	Read, Notify
const DATA_CHAR        = "accb53ba-8a4b-11ed-a1eb-0242ac120002"  // Data	Notify
const DATAREQ_CHAR     = "accb552c-8a4b-11ed-a1eb-0242ac120002"  // Data Request	Write
const ERASE_CHAR       = "accb5946-8a4b-11ed-a1eb-0242ac120002"  // Erase	Write
const USAGE_CHAR       = "accb5be4-8a4b-11ed-a1eb-0242ac120002"  // Usage	Read, Notify
const TIME_CHAR        = "accb5dd8-8a4b-11ed-a1eb-0242ac120002"  // Time	Read

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
        console.log("Device!")
        console.dir(device)
        let server = await device.gatt.connect()
        console.log("Server!")
        let services = await server.getPrimaryServices() 
        services = services.filter( u => u.uuid == SERVICE_UUID)
        if(services.length>0) {
            let service = services[0]
            console.dir(service)
            let chars = await service.getCharacteristics()  
            console.dir(chars)
            console.log("Characteristics...!")

            this.dispatchEvent(new CustomEvent("connected", {detail: device} ))
            device.addEventListener('gattserverdisconnected', () => {
                this.dispatchEvent(new CustomEvent("disconnected", {detail: device} ))
            }, {once:true});

            // Success!
            // TODO: Check for re-connect or initial connect
            this.devices.set(device.id, new uBit(device, service, chars));
        } else {
            console.warn("No service found!")
        } 
    }
}



