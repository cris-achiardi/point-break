import { CFG } from './config.js';
import { STATE } from './surfer.js';
import { clamp, clamp01, lerp } from './rng.js';

const $ = (id) => document.getElementById(id);

// where the pocket meter's three zones sit, in metres of d
const MET_MIN = -12, MET_MAX = 70;
const MET_FOAM = 0, MET_POCKET_END = 22;

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'), spd: $('spd'), time: $('time'), dist: $('dist'),
      score: $('score'), mult: $('mult'), marker: $('marker'),
      callout: $('callout'), trick: $('trick'), weight: $('weight'),
      closing: $('closing'), stance: $('stance'), trimmark: $('trimmark'),
      barrel: $('barrel'), overlay: $('overlay'), card: $('card'),
    };
    this._callout = '';
    this._trickT = 0;
  }

  show(on) { this.el.hud.classList.toggle('on', on); }

  update(surfer, wave, dt) {
    const e = this.el;
    e.spd.textContent = Math.round(surfer.vWater * 3.6);
    e.time.textContent = surfer.time.toFixed(1);
    e.dist.textContent = Math.round(surfer.dist) + 'm';
    e.score.textContent = Math.round(surfer.score).toLocaleString();
    e.mult.textContent = 'x' + surfer.combo.toFixed(1);

    // pocket meter
    const p = clamp01((surfer.d - MET_MIN) / (MET_MAX - MET_MIN));
    e.marker.style.left = (p * 100).toFixed(1) + '%';
    e.marker.style.background = surfer.d < MET_FOAM ? '#ff7a5c'
      : surfer.d < MET_POCKET_END ? '#ffffff' : '#9fd0ff';

    /*
     * Are you gaining on the curl or losing to it? Board speed and progress down the line
     * are different things, and this is the number you trim against to sit in one spot —
     * which is exactly what you are doing when you stall in a barrel.
     */
    const c = surfer.closing;
    e.closing.textContent = Math.abs(c) < 0.6 ? 'HOLDING'
      : (c > 0 ? '▶ +' : '◀ ') + c.toFixed(1);
    e.closing.style.color = Math.abs(c) < 0.6 ? 'var(--pk)'
      : (c > 0 ? '#9fd0ff' : '#ff9b7a');

    // stance bar: a position on the deck, not a spring back to centre
    const w = surfer.w;
    const wi = e.weight;
    wi.classList.toggle('brake', w < 0);
    wi.style.width = (Math.abs(w) * 50).toFixed(1) + '%';
    wi.style.left = w >= 0 ? '50%' : (50 - Math.abs(w) * 50).toFixed(1) + '%';
    // where the board would actually plane best right now, given your speed
    e.trimmark.style.left = (50 + surfer.stanceOpt * 50).toFixed(1) + '%';
    e.trimmark.classList.toggle('near', Math.abs(surfer.w - surfer.stanceOpt) < 0.18);
    e.stance.textContent = surfer.walking > 0.02
      ? (w > 0 ? 'WALKING UP' : 'ON THE TAIL') : '';

    e.barrel.classList.toggle('on', surfer.barreled);

    // what is coming up
    const next = wave.nextSection(surfer.s, 105);
    const cur = wave.kindAt(surfer.s);
    let text = '', tone = '';
    if (next && next.tone) {
      text = next.label + '  ▸ ' + Math.round(next.s - surfer.s) + 'm';
      tone = next.tone;
    } else if (surfer.d < 0) {
      text = 'BEHIND THE CURL'; tone = 'bad';
    } else if (surfer.d > 34) {
      text = 'TOO FAR AHEAD'; tone = 'bad';
    } else if (cur.tone) {
      text = cur.label; tone = cur.tone;
    }
    if (text !== this._callout) {
      this._callout = text;
      e.callout.textContent = text;
      e.callout.className = 'callout' + (text ? ' on ' + tone : '');
    }

    // Trick popups. `kind` used to be ignored entirely; it now tones the popup so a blown
    // snap reads as a mistake and a reverse reads as gold, the way .callout already does.
    for (const ev of surfer.events) {
      e.trick.textContent = ev.text;
      e.trick.className = 'trick';
      void e.trick.offsetWidth;   // restart the animation
      e.trick.className = 'trick pop' + (ev.kind ? ' ' + ev.kind : '');
    }
  }

  overlay(html) {
    this.el.card.innerHTML = html;
    this.el.overlay.classList.remove('off');
  }

  hideOverlay() { this.el.overlay.classList.add('off'); }

  results(surfer, wave, best) {
    const row = (k, v, hi) => `<div class="${hi ? 'hi' : ''}"><span>${k}</span><span>${v}</span></div>`;
    const total = Math.round(surfer.score);
    const wiped = surfer.state === STATE.WIPEOUT;
    const verdict = surfer.endReason;
    return `
      <h1>${wiped ? 'WIPED OUT' : 'KICK OUT'}</h1>
      <p class="sub">${verdict}</p>
      <div class="results">
        ${row('TIME ON THE WAVE', surfer.time.toFixed(1) + 's')}
        ${row('DISTANCE', Math.round(surfer.dist) + 'm')}
        ${row('TOP SPEED', Math.round(surfer.topSpd * 3.6) + ' km/h')}
        ${row('TURNS', surfer.turnCount)}
        ${row('IN THE POCKET', Math.round(surfer.sPocket))}
        ${row('BARREL TIME', surfer.barrelT.toFixed(1) + 's', surfer.barrelT > 0.2)}
        ${row('SCORE', total.toLocaleString(), true)}
      </div>
      <p class="verdict">${best > total ? 'BEST ' + Math.round(best).toLocaleString() : 'NEW BEST'}</p>
      <button id="go">RIDE AGAIN</button>
      <p class="foot">R restart &middot; C camera &middot; M mute</p>
    `;
  }
}
