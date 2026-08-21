var U=Object.defineProperty;var $=i=>{throw TypeError(i)};var V=(i,e,s)=>e in i?U(i,e,{enumerable:!0,configurable:!0,writable:!0,value:s}):i[e]=s;var y=(i,e,s)=>V(i,typeof e!="symbol"?e+"":e,s),L=(i,e,s)=>e.has(i)||$("Cannot "+s);var h=(i,e,s)=>(L(i,e,"read from private field"),s?s.call(i):e.get(i)),m=(i,e,s)=>e.has(i)?$("Cannot add the same private member more than once"):e instanceof WeakSet?e.add(i):e.set(i,s),g=(i,e,s,u)=>(L(i,e,"write to private field"),u?u.call(i,s):e.set(i,s),s),c=(i,e,s)=>(L(i,e,"access private method"),s);const W=["abort","canplay","canplaythrough","durationchange","emptied","encrypted","ended","error","loadeddata","loadedmetadata","loadstart","pause","play","playing","progress","ratechange","seeked","seeking","stalled","suspend","timeupdate","volumechange","waiting","waitingforkey","resize","enterpictureinpicture","leavepictureinpicture","webkitbeginfullscreen","webkitendfullscreen","webkitpresentationmodechanged"],S=["autopictureinpicture","disablepictureinpicture","disableremoteplayback","autoplay","controls","controlslist","crossorigin","loop","muted","playsinline","poster","preload","src"];function G(i){return`
    <style>
      :host {
        display: inline-flex;
        line-height: 0;
        flex-direction: column;
        justify-content: end;
      }

      audio {
        width: 100%;
      }
    </style>
    <slot name="media">
      <audio${I(i)}></audio>
    </slot>
    <slot></slot>
  `}function J(i){return`
    <style>
      :host {
        display: inline-block;
        line-height: 0;
      }

      video {
        max-width: 100%;
        max-height: 100%;
        min-width: 100%;
        min-height: 100%;
        object-fit: var(--media-object-fit, contain);
        object-position: var(--media-object-position, 50% 50%);
      }

      video::-webkit-media-text-track-container {
        transform: var(--media-webkit-text-track-transform);
        transition: var(--media-webkit-text-track-transition);
      }
    </style>
    <slot name="media">
      <video${I(i)}></video>
    </slot>
    <slot></slot>
  `}function B(i,{tag:e,is:s}){var C,P,p,M,T,q,k,w,f,v,b,a,E,O,j,N,x,z,D;const u=(P=(C=globalThis.document)==null?void 0:C.createElement)==null?void 0:P.call(C,e,{is:s}),H=u?K(u):[];return p=class extends i{constructor(){super(...arguments);m(this,a);m(this,k,!1);m(this,w,null);m(this,f,new Map);m(this,v);m(this,b);y(this,"get");y(this,"set");y(this,"call")}static get observedAttributes(){var o,l;return c(o=p,T,q).call(o),[...((l=u==null?void 0:u.constructor)==null?void 0:l.observedAttributes)??[],...S]}get nativeEl(){var t;return c(this,a,E).call(this),h(this,w)??this.querySelector(":scope > [slot=media]")??this.querySelector(e)??((t=this.shadowRoot)==null?void 0:t.querySelector(e))??null}set nativeEl(t){g(this,w,t)}get defaultMuted(){return this.hasAttribute("muted")}set defaultMuted(t){this.toggleAttribute("muted",t)}get src(){return this.getAttribute("src")}set src(t){this.setAttribute("src",`${t}`)}get preload(){var t;return this.getAttribute("preload")??((t=this.nativeEl)==null?void 0:t.preload)}set preload(t){this.setAttribute("preload",`${t}`)}init(){if(!this.shadowRoot){this.attachShadow({mode:"open"});const t=Q(this.attributes);s&&(t.is=s),e&&(t.part=e),this.shadowRoot.innerHTML=this.constructor.getTemplateHTML(t)}this.nativeEl.muted=this.hasAttribute("muted");for(const t of H)c(this,a,z).call(this,t);c(this,a,O).call(this)}handleEvent(t){t.target===this.nativeEl&&this.dispatchEvent(new CustomEvent(t.type,{detail:t.detail}))}attributeChangedCallback(t,o,l){c(this,a,E).call(this),c(this,a,D).call(this,t,o,l)}connectedCallback(){c(this,a,E).call(this),h(this,b)||c(this,a,O).call(this)}disconnectedCallback(){var t,o,l;(t=h(this,v))==null||t.disconnect(),g(this,v,void 0),h(this,b)&&((o=this.shadowRoot)==null||o.removeEventListener("slotchange",h(this,b)),g(this,b,void 0));for(const r of this.constructor.Events)(l=this.shadowRoot)==null||l.removeEventListener(r,this,!0);h(this,f).forEach(r=>r.remove()),h(this,f).clear(),g(this,w,null)}},M=new WeakMap,T=new WeakSet,q=function(){if(h(this,M))return;g(this,M,!0);const t=new Set(this.observedAttributes);t.delete("muted");for(const o of H)if(!(o in this.prototype))if(typeof u[o]=="function")this.prototype[o]=function(...l){return c(this,a,E).call(this),(()=>{var d;if(this.call)return this.call(o,...l);const n=(d=this.nativeEl)==null?void 0:d[o];return n==null?void 0:n.apply(this.nativeEl,l)})()};else{const l={get(){var n,d;c(this,a,E).call(this);const r=o.toLowerCase();if(t.has(r)){const A=this.getAttribute(r);return A===null?!1:A===""?!0:A}return((n=this.get)==null?void 0:n.call(this,o))??((d=this.nativeEl)==null?void 0:d[o])}};o!==o.toUpperCase()&&(l.set=function(r){c(this,a,E).call(this);const n=o.toLowerCase();if(t.has(n)){r===!0||r===!1||r==null?this.toggleAttribute(n,!!r):this.setAttribute(n,r);return}if(this.set){this.set(o,r);return}this.nativeEl&&(this.nativeEl[o]=r)}),Object.defineProperty(this.prototype,o,l)}},k=new WeakMap,w=new WeakMap,f=new WeakMap,v=new WeakMap,b=new WeakMap,a=new WeakSet,E=function(){h(this,k)||(g(this,k,!0),this.init())},O=function(){var t,o;g(this,v,new MutationObserver(c(this,a,N).bind(this))),g(this,b,()=>c(this,a,j).call(this)),(t=this.shadowRoot)==null||t.addEventListener("slotchange",h(this,b)),c(this,a,j).call(this);for(const l of this.constructor.Events)(o=this.shadowRoot)==null||o.addEventListener(l,this,!0)},j=function(){var r;const t=new Map(h(this,f)),o=(r=this.shadowRoot)==null?void 0:r.querySelector("slot:not([name])");(o==null?void 0:o.assignedElements({flatten:!0}).filter(n=>["track","source"].includes(n.localName))).forEach(n=>{var A,R;t.delete(n);let d=h(this,f).get(n);d||(d=n.cloneNode(),h(this,f).set(n,d),(A=h(this,v))==null||A.observe(n,{attributes:!0})),(R=this.nativeEl)==null||R.append(d),c(this,a,x).call(this,d)}),t.forEach((n,d)=>{n.remove(),h(this,f).delete(d)})},N=function(t){for(const o of t)if(o.type==="attributes"){const{target:l,attributeName:r}=o,n=h(this,f).get(l);n&&r&&(n.setAttribute(r,l.getAttribute(r)??""),c(this,a,x).call(this,n))}},x=function(t){t&&t.localName==="track"&&t.default&&(t.kind==="chapters"||t.kind==="metadata")&&t.track.mode==="disabled"&&(t.track.mode="hidden")},z=function(t){if(Object.prototype.hasOwnProperty.call(this,t)){const o=this[t];delete this[t],this[t]=o}},D=function(t,o,l){var r,n,d;["id","class"].includes(t)||!p.observedAttributes.includes(t)&&this.constructor.observedAttributes.includes(t)||(l===null?(r=this.nativeEl)==null||r.removeAttribute(t):((n=this.nativeEl)==null?void 0:n.getAttribute(t))!==l&&((d=this.nativeEl)==null||d.setAttribute(t,l)))},m(p,T),y(p,"getTemplateHTML",e.endsWith("audio")?G:J),y(p,"shadowRootOptions",{mode:"open"}),y(p,"Events",W),m(p,M,!1),p}function K(i){const e=[];for(let s=Object.getPrototypeOf(i);s&&s!==HTMLElement.prototype;s=Object.getPrototypeOf(s)){const u=Object.getOwnPropertyNames(s);e.push(...u)}return e}function I(i){let e="";for(const s in i){if(!S.includes(s))continue;const u=i[s];u===""?e+=` ${s}`:e+=` ${s}="${u}"`}return e}function Q(i){const e={};for(const s of i)e[s.name]=s.value;return e}const Z=B(globalThis.HTMLElement??class{},{tag:"video"});B(globalThis.HTMLElement??class{},{tag:"audio"});export{Z as C};
