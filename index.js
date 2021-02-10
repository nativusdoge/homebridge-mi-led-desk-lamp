const miio = require('miio')
let Service, Characteristic, api;

const _http_base = require("homebridge-http-base");
const http = _http_base.http;
const Cache = _http_base.Cache;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service
    Characteristic = homebridge.hap.Characteristic

    api = homebridge;
    
    homebridge.registerAccessory("homebridge-mi-led-desk-lamp", "mi-led-desk-lamp", MiLedDesklamp)
}

class MiLedDesklamp {

    constructor(log, config) {
        // Setup configuration
        this.log = log
        
        this.adaptiveLightingSupport = this.checkAdaptiveLightingSupport()
        
        this.name = config['name'] || 'Mi desk lamp'
        if (!config['ip']) {
            this.log('No IP address defined for', this.name)
            return
        }
        if (!config['token']) {
            this.log('No token defined for', this.name)
            return
        }
        if (!config['cachetime']) {
            this.log('No cache time defined for', this.name)
            return
        }
        
        this.ip = config['ip']
        this.token = config['token']
        this.cacheTime = config['cachetime']
        
        this.brightnessCache = new Cache(this.cacheTime, 0)

        // Setup services
        this.lamp = new Service.Lightbulb(this.name)
        this.lamp.getCharacteristic(Characteristic.On)
            .on('get', this.getState.bind(this))
            .on('set', this.setState.bind(this))

        this.lamp.getCharacteristic(Characteristic.Brightness)
            .on('get', this.getBrightness.bind(this))
            .on('set', this.setBrightness.bind(this))

        this.lamp.getCharacteristic(Characteristic.ColorTemperature)
            .on('get', this.getColorTemperature.bind(this))
            .on('set', this.setColorTemperature.bind(this))

        this.listenLampState().catch(error => this.log.error(error))
        
        if (this.adaptiveLightingSupport) {
            this.adaptiveLightingController = new api.hap.AdaptiveLightingController(this.lamp)
    	}
    }

    async getLamp() {
        if (this.lampDevice) return this.lampDevice
        this.log('Connect to device')
        try {
            this.lampDevice = await miio.device({address: this.ip, token: this.token})
        } catch (e) {
            this.lampDevice = undefined
            this.log.error('Device not connected', e)
        }
        return this.lampDevice
    }

    async listenLampState(){
        const device = await this.getLamp()
        device.on('powerChanged', isOn => this.lamp.getCharacteristic(Characteristic.On).updateValue(isOn))
        device.on('colorChanged', color => this.lamp.getCharacteristic(Characteristic.ColorTemperature).updateValue(Math.round(1000000 / color.values[0])))
        device.on('brightnessChanged', brightness => this.lamp.getCharacteristic(Characteristic.Brightness).updateValue(brightness))
    }

    async getState(callback) {
        this.log('Get state...')
        try {
            const device = await this.getLamp()
            const power = await device.power()
            callback(null, power)
        } catch (e) {
            this.log.error('Error getting state', e)
            callback(e)
        }
    }

    async setState(state, callback) {
        this.log('Set state to', state)
        try {
            const device = await this.getLamp()
            await device.power(state)
            callback(null)
        } catch (e) {
            this.log.error('Error setting state', e)
            callback(e)
        }
    }

    async getBrightness(callback) {
        this.log('Get brightness...')
        
        if (!this.brightnessCache.shouldQuery()) {
            const value = this.lamp.getCharacteristic(Characteristic.Brightness).value;
            if (this.debug)
                this.log(`getBrightness() returning cached value '${value}'${this.brightnessCache.isInfinite()? " (infinite cache)": ""}`);

            callback(null, value);
            return;
        }
        
        try {
            const device = await this.getLamp()
            const brightness = await device.brightness()
            this.brightnessCache.queried();
            callback(null, brightness)
        } catch (e) {
            this.log.error('Error getting brightness', e)
            callback(e)
        }
    }

    async setBrightness(state, callback) {
	this.log('Set brightness to', state)
	try {
            const device = await this.getLamp()
            await device.brightness('' + state)
            callback(null)
	} catch (e) {
            this.log.error('Error setting brightness', e)
            callback(e)
        }
    }

    async getColorTemperature(callback) {
        this.log('Get color...')
        try {
            const device = await this.getLamp()
            const color = await device.color()
            const miredColor = Math.round(1000000 / color.values[0])
            callback(null, miredColor)
        } catch (e) {
            this.log.error('Error getting brightness', e)
            callback(e)
        }
    }

    async setColorTemperature(miredValue, callback) {
        this.log('Set color to', miredValue)
        let kelvinValue = Math.round(1000000 / miredValue)

        kelvinValue = Math.max(Math.min(kelvinValue, 6500), 2700);

	try {
            const device = await this.getLamp()
            await device.call("set_ct_abx", [kelvinValue, 'smooth', 1000])
            callback(null)
	} catch (e) {
	    this.log.error('Error setting color', e)
	    callback(e)
	}
    }

    getServices() {
        return [this.lamp]
    }
    
    getControllers() {
      if (!this.adaptiveLightingController) {
          return [];
      } else {
          return [this.adaptiveLightingController];
      }
    }
    
    checkAdaptiveLightingSupport() {
        return api.version >= 2.7 && api.versionGreaterOrEqual("1.3.0-beta.19")
            || !!api.hap.AdaptiveLightingController; // support check on Hoobs
    }
}
