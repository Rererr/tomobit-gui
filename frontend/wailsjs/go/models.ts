export namespace main {
	
	export class TurnReply {
	    text: string;
	
	    static createFrom(source: any = {}) {
	        return new TurnReply(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.text = source["text"];
	    }
	}

}

