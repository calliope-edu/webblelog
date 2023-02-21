
/*
 * JavaScript functions for interacting with micro:bit microcontrollers over WebBluetooth
 * (Only works in Chrome browsers;  Pages must be either HTTPS or local)
 */

class uBit extends EventTarget {
   constructor() {
    this.name = ""
   }


}



class uBitManager extends EventTarget  {
    constructor() {
        super()
        // Code
    }

    /**
     * Connect to a device
     */
    async connect() {
        // let device = navigator.bluetooth.requestDevice({filters:[{namePrefix:"uBit"}]});
        let device = await navigator.bluetooth.requestDevice({filters:[{namePrefix:"uBit"}], optionalServices: ["accb4ce4-8a4b-11ed-a1eb-0242ac120002"]});
        console.log("Device!")
        console.dir(device)
        let server = await device.gatt.connect()
        console.log("Server!")
        let services = await server.getPrimaryServices() 
        console.log("Services!")
        let chars = await services[0].getCharacteristics()  
        console.log("Characteristics...!")
        
        this.dispatchEvent(new CustomEvent("connected", {detail: device} ))
        device.addEventListener('gattserverdisconnected', () => {
            this.dispatchEvent(new CustomEvent("disconnected", {detail: device} ))
        });

    }
}



