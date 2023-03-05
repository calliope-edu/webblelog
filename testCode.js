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

// https://stackoverflow.com/questions/951021/what-is-the-javascript-version-of-sleep
// Testing / timing
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

    // async readLength() {
    //     let length = await this.dataLen.readValue()
    //     let intLength = length.getUint32(0,true)
    //     return intLength        
    // }