export namespace main {
	
	export class Connection {
	    kind: string;
	    scope_key: string;
	    target: string;
	    alpha: number;
	    beta: number;
	    prior_alpha: number;
	    prior_beta: number;
	    last_update: number;
	
	    static createFrom(source: any = {}) {
	        return new Connection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.scope_key = source["scope_key"];
	        this.target = source["target"];
	        this.alpha = source["alpha"];
	        this.beta = source["beta"];
	        this.prior_alpha = source["prior_alpha"];
	        this.prior_beta = source["prior_beta"];
	        this.last_update = source["last_update"];
	    }
	}
	export class CuriosityItem {
	    id: string;
	    created_ts: number;
	    signal: string;
	    payload: string;
	    priority: number;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new CuriosityItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.created_ts = source["created_ts"];
	        this.signal = source["signal"];
	        this.payload = source["payload"];
	        this.priority = source["priority"];
	        this.status = source["status"];
	    }
	}
	export class DigestItem {
	    kind: string;
	    text: string;
	    n: number;
	
	    static createFrom(source: any = {}) {
	        return new DigestItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.n = source["n"];
	    }
	}
	export class Experience {
	    id: string;
	    session_id: string;
	    ts: number;
	    kind: string;
	    provider: string;
	    context: string;
	    outcome: string;
	
	    static createFrom(source: any = {}) {
	        return new Experience(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.session_id = source["session_id"];
	        this.ts = source["ts"];
	        this.kind = source["kind"];
	        this.provider = source["provider"];
	        this.context = source["context"];
	        this.outcome = source["outcome"];
	    }
	}
	export class GUIConfig {
	    speaking_style: string;
	
	    static createFrom(source: any = {}) {
	        return new GUIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.speaking_style = source["speaking_style"];
	    }
	}
	export class MemoryView {
	    db_path: string;
	    exists: boolean;
	    connections: Connection[];
	    experiences: Experience[];
	    curiosity: CuriosityItem[];
	
	    static createFrom(source: any = {}) {
	        return new MemoryView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.db_path = source["db_path"];
	        this.exists = source["exists"];
	        this.connections = this.convertValues(source["connections"], Connection);
	        this.experiences = this.convertValues(source["experiences"], Experience);
	        this.curiosity = this.convertValues(source["curiosity"], CuriosityItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SessionDetail {
	    session_id: string;
	    start_ts: number;
	    status: string;
	    items: DigestItem[];
	
	    static createFrom(source: any = {}) {
	        return new SessionDetail(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.start_ts = source["start_ts"];
	        this.status = source["status"];
	        this.items = this.convertValues(source["items"], DigestItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SessionDigest {
	    session_id: string;
	    start_ts: number;
	    end_ts: number;
	    intent: string;
	    turns: number;
	    status: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new SessionDigest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session_id = source["session_id"];
	        this.start_ts = source["start_ts"];
	        this.end_ts = source["end_ts"];
	        this.intent = source["intent"];
	        this.turns = source["turns"];
	        this.status = source["status"];
	        this.source = source["source"];
	    }
	}
	export class SessionList {
	    exists: boolean;
	    sessions: SessionDigest[];
	
	    static createFrom(source: any = {}) {
	        return new SessionList(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exists = source["exists"];
	        this.sessions = this.convertValues(source["sessions"], SessionDigest);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TomoStatus {
	    exists: boolean;
	    stage: number;
	    stage_name: string;
	
	    static createFrom(source: any = {}) {
	        return new TomoStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exists = source["exists"];
	        this.stage = source["stage"];
	        this.stage_name = source["stage_name"];
	    }
	}

}

