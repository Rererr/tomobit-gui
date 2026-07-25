export namespace main {
	
	export class AmendRequest {
	    id: string;
	    set_context: boolean;
	    context: string;
	    set_outcome: boolean;
	    outcome: string;
	    set_provider: boolean;
	    provider: string;
	
	    static createFrom(source: any = {}) {
	        return new AmendRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.set_context = source["set_context"];
	        this.context = source["context"];
	        this.set_outcome = source["set_outcome"];
	        this.outcome = source["outcome"];
	        this.set_provider = source["set_provider"];
	        this.provider = source["provider"];
	    }
	}
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
	    face_enabled?: boolean;
	    transcript_cache?: boolean;
	    working_dir?: string;
	    read_dirs?: string[];
	    provider?: string;
	    sidebar_tomo_collapsed?: boolean;
	    sidebar_usage_collapsed?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GUIConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.speaking_style = source["speaking_style"];
	        this.face_enabled = source["face_enabled"];
	        this.transcript_cache = source["transcript_cache"];
	        this.working_dir = source["working_dir"];
	        this.read_dirs = source["read_dirs"];
	        this.provider = source["provider"];
	        this.sidebar_tomo_collapsed = source["sidebar_tomo_collapsed"];
	        this.sidebar_usage_collapsed = source["sidebar_usage_collapsed"];
	    }
	}
	export class GrowthGate {
	    name: string;
	    value?: number;
	    threshold: number;
	    met: boolean;
	    hint?: string;
	
	    static createFrom(source: any = {}) {
	        return new GrowthGate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.threshold = source["threshold"];
	        this.met = source["met"];
	        this.hint = source["hint"];
	    }
	}
	export class Growth {
	    next: number;
	    next_name: string;
	    gates: GrowthGate[];
	
	    static createFrom(source: any = {}) {
	        return new Growth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.next = source["next"];
	        this.next_name = source["next_name"];
	        this.gates = this.convertValues(source["gates"], GrowthGate);
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
	export class Mood {
	    name: string;
	    marker: string;
	
	    static createFrom(source: any = {}) {
	        return new Mood(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.marker = source["marker"];
	    }
	}
	export class ProviderUsage {
	    provider: string;
	    runs: number;
	    first_ts: number;
	    last_ts: number;
	    success: number;
	    scored: number;
	
	    static createFrom(source: any = {}) {
	        return new ProviderUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.runs = source["runs"];
	        this.first_ts = source["first_ts"];
	        this.last_ts = source["last_ts"];
	        this.success = source["success"];
	        this.scored = source["scored"];
	    }
	}
	export class QuotaWindow {
	    label: string;
	    used_percent: number;
	    resets_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new QuotaWindow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.used_percent = source["used_percent"];
	        this.resets_at = source["resets_at"];
	    }
	}
	export class QuotaStatus {
	    provider: string;
	    windows?: QuotaWindow[];
	    error?: string;
	    observed_at?: number;
	
	    static createFrom(source: any = {}) {
	        return new QuotaStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.windows = this.convertValues(source["windows"], QuotaWindow);
	        this.error = source["error"];
	        this.observed_at = source["observed_at"];
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
	export class SessionScrollback {
	    exists: boolean;
	    events: any[];
	
	    static createFrom(source: any = {}) {
	        return new SessionScrollback(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exists = source["exists"];
	        this.events = source["events"];
	    }
	}
	export class SpriteAnim {
	    blink_min_ms: number;
	    blink_jitter_ms: number;
	    blink_hold_ms: number;
	    bob_period_ms: number;
	    bob_px: number;
	
	    static createFrom(source: any = {}) {
	        return new SpriteAnim(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.blink_min_ms = source["blink_min_ms"];
	        this.blink_jitter_ms = source["blink_jitter_ms"];
	        this.blink_hold_ms = source["blink_hold_ms"];
	        this.bob_period_ms = source["bob_period_ms"];
	        this.bob_px = source["bob_px"];
	    }
	}
	export class SpriteOverlay {
	    marker: string;
	    rows: string[];
	
	    static createFrom(source: any = {}) {
	        return new SpriteOverlay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.marker = source["marker"];
	        this.rows = source["rows"];
	    }
	}
	export class SpriteStage {
	    stage: number;
	    name: string;
	    frames: string[][];
	    overlay_origin: Record<string, Array<number>>;
	
	    static createFrom(source: any = {}) {
	        return new SpriteStage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.stage = source["stage"];
	        this.name = source["name"];
	        this.frames = source["frames"];
	        this.overlay_origin = source["overlay_origin"];
	    }
	}
	export class SpriteSheet {
	    type: string;
	    size: number;
	    breed: string;
	    palette: Record<string, string>;
	    stages: SpriteStage[];
	    overlays: SpriteOverlay[];
	    anim: SpriteAnim;
	
	    static createFrom(source: any = {}) {
	        return new SpriteSheet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.size = source["size"];
	        this.breed = source["breed"];
	        this.palette = source["palette"];
	        this.stages = this.convertValues(source["stages"], SpriteStage);
	        this.overlays = this.convertValues(source["overlays"], SpriteOverlay);
	        this.anim = this.convertValues(source["anim"], SpriteAnim);
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
	    mood?: Mood;
	    speak?: string;
	    providers?: ProviderUsage[];
	    growth?: Growth;
	    quota?: QuotaStatus[];
	
	    static createFrom(source: any = {}) {
	        return new TomoStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exists = source["exists"];
	        this.stage = source["stage"];
	        this.stage_name = source["stage_name"];
	        this.mood = this.convertValues(source["mood"], Mood);
	        this.speak = source["speak"];
	        this.providers = this.convertValues(source["providers"], ProviderUsage);
	        this.growth = this.convertValues(source["growth"], Growth);
	        this.quota = this.convertValues(source["quota"], QuotaStatus);
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
	export class WorkspaceUpdate {
	    config: GUIConfig;
	    pending: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceUpdate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.config = this.convertValues(source["config"], GUIConfig);
	        this.pending = source["pending"];
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
	export class WriteResult {
	    summary: string;
	    notice: string;
	
	    static createFrom(source: any = {}) {
	        return new WriteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.summary = source["summary"];
	        this.notice = source["notice"];
	    }
	}

}

