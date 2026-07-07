import './ui/style.css';

import {
  createGame,
  step,
  canPlace,
  placeTower,
  upgradeCost,
  upgradeTower,
  sellTower,
  skipWave,
  startEndless,
} from './sim/engine';
import { MAPS } from './sim/maps';
import { GameRenderer } from './render/renderer';
import {
  TICK,
  TOTAL_WAVES,
  TOWERS,
  SKIP_RATE,
  SKIP_WAVE_SCALE,
  DMG_MUL,
  SPD_MUL,
  MAX_UPGRADE,
  SELL_REFUND,
} from './sim/constants';
import { hexToWorld } from './sim/hex';
import type { GameState, MapDef, TowerKind, Tower, SimEvent } from './sim/types';

import { el, clear, show } from './ui/dom';
import {
  readSave,
  writeSave,
  clearSave,
  hasSave,
  readMeta,
  writeMeta,
} from './ui/save';
import { installAutomation } from './ui/automation';

const TOWER_ORDER: TowerKind[] = ['plinker', 'freeze', 'cannon', 'lightning', 'doom'];
const TOWER_ICON: Record<TowerKind, string> = {
  plinker: '🪨',
  freeze: '❄️',
  cannon: '💣',
  lightning: '⚡',
  doom: '🌟',
};

// Per-map flavour for the menu cards, keyed by map id (falls back to index order).
const MAP_META: Record<string, { emoji: string; hint: string }> = {
  meadow: { emoji: '🌸', hint: 'a gentle stroll' },
  creek: { emoji: '🏞️', hint: 'twisty & tight' },
  double: { emoji: '🔀', hint: 'two paths, one home' },
};
const FALLBACK_EMOJI = ['🌸', '🏞️', '🔀'];

const DMG_PCT = Math.round((DMG_MUL - 1) * 100); // 45
const SPD_PCT = Math.round((SPD_MUL - 1) * 100); // 30

const SAVE_INTERVAL = 5; // seconds of sim/real time between autosaves

interface PointerStart {
  x: number;
  y: number;
  t: number;
}

class App {
  private root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: GameRenderer;

  state: GameState | null = null;
  private map: MapDef | null = null;

  private speed: 1 | 2 = 1;
  private paused = false;
  private armed: TowerKind | null = null;
  private selectedTowerId: number | null = null;

  private acc = 0;
  private lastFrame = 0;
  private lastSaveAt = 0;
  private prevStatus: GameState['status'] = 'playing';
  private menuMapId: string;

  // --- screen roots ---
  private menuScreen!: HTMLElement;
  private hudScreen!: HTMLElement;
  private overlay: HTMLElement | null = null; // pause/win/lose/confirm (one at a time)

  // --- hud refs ---
  private livesEl!: HTMLElement;
  private moneyEl!: HTMLElement;
  private waveEl!: HTMLElement;
  private cdEl!: HTMLElement;
  private skipBtn!: HTMLButtonElement;
  private skipAmtEl!: HTMLElement;
  private speedBtn!: HTMLButtonElement;
  private toastEl!: HTMLElement;
  private buildbar!: HTMLElement;
  private towerBtns: Partial<Record<TowerKind, HTMLButtonElement>> = {};

  private towerPanel: HTMLElement | null = null;
  private panelUpdate: (() => void) | null = null;

  private ptrStart: PointerStart | null = null;

  constructor() {
    this.root = document.getElementById('ui-root')!;
    this.canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new GameRenderer(this.canvas);
    this.menuMapId = MAPS[0]?.id ?? 'meadow';

    const meta = readMeta();
    this.speed = meta.speed;

    this.buildMenu();
    this.buildHud();
    this.wireCanvas();
    this.wireGlobal();

    installAutomation({
      get state() {
        return app.state;
      },
      actions: {
        newGame: (mapId, seed) => this.startGame(mapId, seed),
        place: (kind, q, r) =>
          this.state && this.map
            ? placeTower(this.state, this.map, kind, q, r)
            : false,
        upgrade: (towerId, which) => {
          const ok = this.state ? upgradeTower(this.state, towerId, which) : false;
          if (ok) this.refreshBuildAndPanel();
          return ok;
        },
        sell: (towerId) => {
          const ok = this.state ? sellTower(this.state, towerId) : false;
          if (ok) this.closeTowerPanel();
          return ok;
        },
        skip: () => (this.state && this.map ? skipWave(this.state, this.map) : 0),
        setSpeed: (x) => this.setSpeed(x),
        pause: () => this.pause(),
        resume: () => this.resume(),
        endless: () => this.doEndless(),
      },
    });

    this.showMenu();
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- menu

  private buildMenu() {
    const title = el(
      'h1',
      { class: 'title' },
      ...'Cuteness'.split('').map((c) => el('span', {}, c)),
      el('br'),
      ...'Overload'.split('').map((c) => el('span', {}, c)),
    );
    const subtitle = el(
      'p',
      { class: 'subtitle' },
      "they're adorable. they're coming for your home. 🏠",
    );

    const mapList = el('div', { class: 'map-list' });
    MAPS.forEach((m, i) => {
      const meta = MAP_META[m.id] ?? { emoji: FALLBACK_EMOJI[i] ?? '🗺️', hint: '' };
      const stars = '★'.repeat(i + 1) + '☆'.repeat(Math.max(0, 2 - i));
      const card = el(
        'button',
        { class: 'map-card', 'data-id': m.id },
        el('div', { class: 'map-emoji' }, meta.emoji),
        el(
          'div',
          { class: 'map-info' },
          el('div', { class: 'map-name' }, m.name),
          el('div', { class: 'map-hint' }, meta.hint),
        ),
        el('div', { class: 'map-stars' }, stars),
      );
      card.addEventListener('click', () => {
        this.menuMapId = m.id;
        mapList.querySelectorAll('.map-card').forEach((c) => c.classList.remove('sel'));
        card.classList.add('sel');
      });
      if (m.id === this.menuMapId) card.classList.add('sel');
      mapList.append(card);
    });

    const continueBtn = el('button', { class: 'btn btn-mint' }, '▶️ Continue');
    continueBtn.addEventListener('click', () => this.continueGame());

    const newBtn = el('button', { class: 'btn btn-primary' }, '🌸 New Game');
    newBtn.addEventListener('click', () => {
      if (hasSave()) {
        this.showConfirm(
          'Start a new game?',
          'This will overwrite your saved game.',
          () => this.startGame(this.menuMapId),
        );
      } else {
        this.startGame(this.menuMapId);
      }
    });

    const actions = el('div', { class: 'menu-actions' }, continueBtn, newBtn);

    this.menuScreen = el(
      'div',
      { class: 'screen tint' },
      title,
      subtitle,
      mapList,
      actions,
    );
    // store ref to continue button for show/hide
    (this.menuScreen as any)._continueBtn = continueBtn;
    this.root.append(this.menuScreen);
  }

  private showMenu() {
    this.state = null;
    this.map = null;
    this.armed = null;
    this.closeTowerPanel();
    this.dismissOverlay();
    show(this.hudScreen, false);
    show(this.menuScreen, true);
    const cont = (this.menuScreen as any)._continueBtn as HTMLElement;
    show(cont, hasSave());
    this.renderer.setHover(null, false);
    this.renderer.hideRange();
  }

  // ---------------------------------------------------------------- hud

  private buildHud() {
    // top bar
    this.livesEl = el('span', {}, '20');
    this.moneyEl = el('span', {}, '0');
    this.waveEl = el('span', {}, 'Wave 1');
    this.cdEl = el('span', { class: 'cd' }, '');

    const livesPill = el(
      'div',
      { class: 'stat-pill' },
      el('span', { class: 'emoji' }, '💖'),
      this.livesEl,
    );
    const moneyPill = el(
      'div',
      { class: 'stat-pill' },
      el('span', { class: 'emoji' }, '🪙'),
      this.moneyEl,
    );

    this.skipAmtEl = el('small', {}, '+0 🪙');
    this.skipBtn = el(
      'button',
      { class: 'btn btn-lemon skip-btn' },
      el('span', {}, '⏭️ Skip'),
      this.skipAmtEl,
    ) as HTMLButtonElement;
    this.skipBtn.addEventListener('click', () => this.doSkip());

    this.speedBtn = el('button', { class: 'btn icon-btn' }, this.speed + '×') as HTMLButtonElement;
    this.speedBtn.addEventListener('click', () => this.setSpeed(this.speed === 1 ? 2 : 1));

    const pauseBtn = el('button', { class: 'btn icon-btn' }, '⏸️') as HTMLButtonElement;
    pauseBtn.addEventListener('click', () => this.pause());

    const topbar = el(
      'div',
      { class: 'topbar' },
      livesPill,
      moneyPill,
      el('div', { class: 'spacer' }),
      this.skipBtn,
      this.speedBtn,
      pauseBtn,
    );

    const waveBanner = el(
      'div',
      { class: 'wave-banner' },
      this.waveEl,
      el('span', {}, '  '),
      this.cdEl,
    );

    this.toastEl = el('div', { class: 'toast' });

    // build bar
    this.buildbar = el('div', { class: 'buildbar' });
    for (const kind of TOWER_ORDER) {
      const spec = TOWERS[kind];
      const btn = el(
        'button',
        { class: 'tower-btn', title: spec.desc },
        el('div', { class: 'ico' }, TOWER_ICON[kind]),
        el('div', { class: 'nm' }, spec.name),
        el('div', { class: 'cost' }, String(spec.cost)),
      ) as HTMLButtonElement;
      btn.addEventListener('click', () => this.arm(kind));
      this.towerBtns[kind] = btn;
      this.buildbar.append(btn);
    }

    this.hudScreen = el(
      'div',
      { class: 'hud hidden' },
      topbar,
      waveBanner,
      this.toastEl,
      this.buildbar,
    );
    this.root.append(this.hudScreen);
  }

  private updateHud() {
    const s = this.state;
    if (!s) return;
    this.livesEl.textContent = String(Math.max(0, Math.floor(s.lives)));
    this.moneyEl.textContent = String(Math.floor(s.money));

    const w = s.wave;
    if (s.endless) {
      this.waveEl.textContent = `Wave ${w} ∞`;
    } else {
      this.waveEl.textContent = `Wave ${Math.min(Math.max(w, 1), TOTAL_WAVES)} / ${TOTAL_WAVES}`;
    }

    const noMoreWaves = !s.endless && w >= TOTAL_WAVES;
    const remaining = Math.max(0, s.nextWaveAt - s.time);
    if (noMoreWaves) {
      this.cdEl.textContent = 'final wave!';
    } else {
      this.cdEl.textContent = `next in ${Math.ceil(remaining)}s`;
    }

    // skip preview bonus
    const bonus = noMoreWaves
      ? 0
      : Math.floor(remaining * SKIP_RATE * (1 + w * SKIP_WAVE_SCALE));
    this.skipAmtEl.textContent = `+${bonus} 🪙`;
    this.skipBtn.disabled = noMoreWaves;

    // build bar affordability
    for (const kind of TOWER_ORDER) {
      const btn = this.towerBtns[kind]!;
      btn.disabled = s.money < TOWERS[kind].cost;
      btn.classList.toggle('armed', this.armed === kind);
    }

    this.panelUpdate?.();
  }

  // ---------------------------------------------------------------- game control

  private startGame(mapId: string, seed?: number) {
    const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
    if (!map) return;
    const s = createGame(map, seed ?? ((Math.random() * 0x7fffffff) | 0));
    this.enterGame(s, map);
  }

  private continueGame() {
    const blob = readSave();
    if (!blob) {
      this.showMenu();
      return;
    }
    const map = MAPS.find((m) => m.id === blob.mapId);
    if (!map) {
      clearSave();
      this.showMenu();
      return;
    }
    this.enterGame(blob.state, map);
  }

  private enterGame(s: GameState, map: MapDef) {
    this.state = s;
    this.map = map;
    this.prevStatus = s.status;
    this.armed = null;
    this.acc = 0;
    this.lastSaveAt = s.time;
    this.paused = false;
    this.closeTowerPanel();
    this.dismissOverlay();
    this.renderer.setMap(map);
    this.renderer.setHover(null, false);
    this.renderer.hideRange();
    this.menuMapId = map.id;
    show(this.menuScreen, false);
    show(this.hudScreen, true);
    this.updateHud();
    // if resumed a finished game, reflect it
    if (s.status === 'won') this.showWin();
    else if (s.status === 'lost') this.showLose();
  }

  private setSpeed(x: 1 | 2) {
    this.speed = x;
    this.speedBtn.textContent = x + '×';
    writeMeta({ speed: x });
  }

  private pause() {
    if (!this.state || this.state.status !== 'playing') return;
    if (this.overlay) return;
    this.paused = true;
    this.showPause();
  }

  private resume() {
    this.paused = false;
    this.dismissOverlay();
  }

  private doSkip() {
    if (!this.state || !this.map || this.state.status !== 'playing') return;
    skipWave(this.state, this.map);
    this.updateHud();
  }

  private doEndless() {
    if (!this.state) return;
    startEndless(this.state);
    this.prevStatus = this.state.status;
    this.paused = false;
    this.dismissOverlay();
    this.lastSaveAt = this.state.time;
  }

  // ---------------------------------------------------------------- placement / selection

  private arm(kind: TowerKind) {
    if (!this.state || this.state.status !== 'playing') return;
    if (this.armed === kind) {
      this.disarm();
      return;
    }
    this.closeTowerPanel();
    this.armed = kind;
    this.updateHud();
  }

  private disarm() {
    this.armed = null;
    this.renderer.setHover(null, false);
    this.renderer.hideRange();
    this.updateHud();
  }

  private updatePlacementPreview(cx: number, cy: number) {
    if (!this.armed || !this.state || !this.map) return;
    const hex = this.renderer.pickHex(cx, cy);
    if (!hex) {
      this.renderer.setHover(null, false);
      this.renderer.hideRange();
      return;
    }
    const valid = canPlace(this.state, this.map, this.armed, hex.q, hex.r);
    this.renderer.setHover(hex, valid);
    const { x, z } = hexToWorld(hex.q, hex.r);
    this.renderer.showRange(x, z, TOWERS[this.armed].range);
  }

  private tryPlaceAt(cx: number, cy: number) {
    if (!this.armed || !this.state || !this.map) return;
    const hex = this.renderer.pickHex(cx, cy);
    if (!hex) return;
    const kind = this.armed;
    if (placeTower(this.state, this.map, kind, hex.q, hex.r)) {
      this.updateHud();
      if (this.state.money < TOWERS[kind].cost) this.disarm();
      else this.updatePlacementPreview(cx, cy);
    }
  }

  private towerAt(q: number, r: number): Tower | undefined {
    return this.state?.towers.find((t) => t.q === q && t.r === r);
  }

  private towerById(id: number): Tower | undefined {
    return this.state?.towers.find((t) => t.id === id);
  }

  private selectTower(id: number) {
    if (!this.state) return;
    const tower = this.towerById(id);
    if (!tower) return;
    this.disarm();
    this.selectedTowerId = id;
    show(this.buildbar, false);
    this.buildTowerPanel(id);
    const { x, z } = hexToWorld(tower.q, tower.r);
    this.renderer.showRange(x, z, TOWERS[tower.kind].range);
  }

  private closeTowerPanel() {
    this.selectedTowerId = null;
    this.panelUpdate = null;
    if (this.towerPanel) {
      this.towerPanel.remove();
      this.towerPanel = null;
    }
    if (this.hudScreen) show(this.buildbar, true);
    this.renderer.hideRange();
  }

  private buildTowerPanel(id: number) {
    if (this.towerPanel) this.towerPanel.remove();
    const tower = this.towerById(id);
    if (!tower) return;
    const spec = TOWERS[tower.kind];

    const dmgPips = el('div', { class: 'pips' });
    const spdPips = el('div', { class: 'pips' });

    const dmgCostEl = el('div', { class: 'pcost' }, '');
    const spdCostEl = el('div', { class: 'pcost' }, '');

    const dmgBtn = el(
      'button',
      { class: 'btn btn-danger upg-btn' },
      el('div', { class: 'lab' }, '⚔️ Damage'),
      el('div', { class: 'amt' }, `+${DMG_PCT}% dmg`),
      dmgCostEl,
    ) as HTMLButtonElement;
    dmgBtn.addEventListener('click', () => {
      if (this.state && upgradeTower(this.state, id, 'dmg')) this.refreshBuildAndPanel();
    });

    const spdBtn = el(
      'button',
      { class: 'btn btn-mint upg-btn' },
      el('div', { class: 'lab' }, '⚡ Speed'),
      el('div', { class: 'amt' }, `+${SPD_PCT}% spd`),
      spdCostEl,
    ) as HTMLButtonElement;
    spdBtn.addEventListener('click', () => {
      if (this.state && upgradeTower(this.state, id, 'spd')) this.refreshBuildAndPanel();
    });

    const sellBtn = el('button', { class: 'btn sell-btn' }, 'Sell') as HTMLButtonElement;
    sellBtn.addEventListener('click', () => {
      if (this.state && sellTower(this.state, id)) {
        this.updateHud();
        this.closeTowerPanel();
      }
    });

    const closeBtn = el('button', { class: 'btn tp-close' }, '✕') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => this.closeTowerPanel());

    const panel = el(
      'div',
      { class: 'tower-panel' },
      el(
        'div',
        { class: 'tp-head' },
        el('div', { class: 'tp-ico' }, TOWER_ICON[tower.kind]),
        el(
          'div',
          { class: 'tp-title' },
          el('div', { class: 'tp-name' }, spec.name),
          el('div', { class: 'tp-desc' }, spec.desc),
        ),
        closeBtn,
      ),
      el(
        'div',
        { class: 'upg-row' },
        el('div', { style: 'flex:1', class: 'upg-col' }, dmgBtn, dmgPips),
        el('div', { style: 'flex:1', class: 'upg-col' }, spdBtn, spdPips),
      ),
      el('div', { class: 'tp-foot' }, sellBtn),
    );

    // reposition pips inside columns for alignment
    (dmgBtn.parentElement as HTMLElement).style.display = 'flex';
    (dmgBtn.parentElement as HTMLElement).style.flexDirection = 'column';
    (dmgBtn.parentElement as HTMLElement).style.alignItems = 'center';
    (dmgBtn.parentElement as HTMLElement).style.gap = '6px';
    (spdBtn.parentElement as HTMLElement).style.display = 'flex';
    (spdBtn.parentElement as HTMLElement).style.flexDirection = 'column';
    (spdBtn.parentElement as HTMLElement).style.alignItems = 'center';
    (spdBtn.parentElement as HTMLElement).style.gap = '6px';

    this.towerPanel = panel;
    this.hudScreen.append(panel);

    const renderPips = (container: HTMLElement, level: number) => {
      clear(container);
      for (let i = 0; i < MAX_UPGRADE; i++) {
        container.append(el('div', { class: 'pip' + (i < level ? ' on' : '') }));
      }
    };

    this.panelUpdate = () => {
      const t = this.towerById(id);
      if (!t || !this.state) {
        this.closeTowerPanel();
        return;
      }
      renderPips(dmgPips, t.dmgLevel);
      renderPips(spdPips, t.spdLevel);

      const dc = upgradeCost(t, 'dmg');
      if (dc === null) {
        dmgCostEl.textContent = 'MAX';
        dmgBtn.disabled = true;
      } else {
        dmgCostEl.textContent = `🪙 ${dc}`;
        dmgBtn.disabled = this.state.money < dc;
      }
      const sc = upgradeCost(t, 'spd');
      if (sc === null) {
        spdCostEl.textContent = 'MAX';
        spdBtn.disabled = true;
      } else {
        spdCostEl.textContent = `🪙 ${sc}`;
        spdBtn.disabled = this.state.money < sc;
      }

      const refund = Math.floor(t.spent * SELL_REFUND);
      sellBtn.textContent = `💰 Sell  +${refund} 🪙`;
    };
    this.panelUpdate();
  }

  private refreshBuildAndPanel() {
    this.updateHud();
    this.panelUpdate?.();
  }

  // ---------------------------------------------------------------- overlays

  private dismissOverlay() {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  private showConfirm(title: string, body: string, onYes: () => void) {
    this.dismissOverlay();
    const yes = el('button', { class: 'btn btn-primary' }, 'Yes! 💖');
    const no = el('button', { class: 'btn' }, 'Nevermind');
    yes.addEventListener('click', () => {
      this.dismissOverlay();
      onYes();
    });
    no.addEventListener('click', () => this.dismissOverlay());
    this.overlay = el(
      'div',
      { class: 'overlay' },
      el('div', { class: 'big-face' }, '🤔'),
      el('h2', {}, title),
      el('p', { class: 'subtitle' }, body),
      el('div', { class: 'menu-actions' }, yes, no),
    );
    this.root.append(this.overlay);
  }

  private showPause() {
    this.dismissOverlay();
    const resumeBtn = el('button', { class: 'btn btn-primary' }, '▶️ Resume');
    resumeBtn.addEventListener('click', () => this.resume());

    const restartBtn = el('button', { class: 'btn btn-lemon' }, '🔄 Restart');
    restartBtn.addEventListener('click', () => {
      const mapId = this.map?.id ?? this.menuMapId;
      this.startGame(mapId);
    });

    const quitBtn = el('button', { class: 'btn' }, '🏠 Quit to Menu');
    quitBtn.addEventListener('click', () => {
      this.showConfirm('Quit to menu?', 'Your progress stays saved.', () => {
        this.paused = false;
        this.showMenu();
      });
    });

    this.overlay = el(
      'div',
      { class: 'overlay' },
      el('div', { class: 'big-face' }, '⏸️'),
      el('h2', {}, 'Paused'),
      el('p', { class: 'subtitle' }, 'take a little breather 🌸'),
      el('div', { class: 'menu-actions' }, resumeBtn, restartBtn, quitBtn),
    );
    this.root.append(this.overlay);
  }

  private statsChips(): HTMLElement {
    const s = this.state!;
    const mins = Math.floor(s.time / 60);
    const secs = Math.floor(s.time % 60);
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    return el(
      'div',
      { class: 'stats' },
      el('div', { class: 'stat-chip' }, el('small', {}, 'Kills'), el('b', {}, String(s.kills))),
      el('div', { class: 'stat-chip' }, el('small', {}, 'Leaks'), el('b', {}, String(s.leaks))),
      el('div', { class: 'stat-chip' }, el('small', {}, 'Time'), el('b', {}, timeStr)),
    );
  }

  private confetti(): HTMLElement {
    const wrap = el('div', { class: 'confetti' });
    const colors = ['#ff9ecb', '#b79bff', '#9be7d0', '#a9d7ff', '#ffe59b'];
    for (let i = 0; i < 40; i++) {
      const left = Math.random() * 100;
      const dur = 2.5 + Math.random() * 3;
      const delay = -Math.random() * 5;
      const color = colors[i % colors.length];
      wrap.append(
        el('i', {
          style: `left:${left}vw;background:${color};animation-duration:${dur}s;animation-delay:${delay}s`,
        }),
      );
    }
    return wrap;
  }

  private showWin() {
    this.dismissOverlay();
    if (!this.state) return;
    const endlessBtn = el('button', { class: 'btn btn-primary' }, '♾️ Endless Mode');
    endlessBtn.addEventListener('click', () => this.doEndless());
    const menuBtn = el('button', { class: 'btn btn-mint' }, '🏠 Back to Menu');
    menuBtn.addEventListener('click', () => this.showMenu());

    this.overlay = el(
      'div',
      { class: 'overlay' },
      this.confetti(),
      el('div', { class: 'big-face' }, '🎉'),
      el('h2', {}, 'You saved the day!'),
      el('p', { class: 'subtitle' }, 'the cuties are defeated (adorably) 💖'),
      this.statsChips(),
      el('div', { class: 'menu-actions' }, endlessBtn, menuBtn),
    );
    this.root.append(this.overlay);
  }

  private showLose() {
    this.dismissOverlay();
    if (!this.state) return;
    const retryBtn = el('button', { class: 'btn btn-primary' }, '🔄 Retry');
    retryBtn.addEventListener('click', () => {
      const mapId = this.map?.id ?? this.menuMapId;
      this.startGame(mapId);
    });
    const menuBtn = el('button', { class: 'btn btn-mint' }, '🏠 Menu');
    menuBtn.addEventListener('click', () => this.showMenu());

    this.overlay = el(
      'div',
      { class: 'overlay' },
      el('div', { class: 'big-face' }, '😿'),
      el('h2', {}, 'They got in!'),
      el('p', { class: 'subtitle' }, 'your home was overwhelmed by cuteness…'),
      this.statsChips(),
      el('div', { class: 'menu-actions' }, retryBtn, menuBtn),
    );
    this.root.append(this.overlay);
  }

  private showToast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('show');
    // force reflow so the animation restarts
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add('show');
  }

  // ---------------------------------------------------------------- input wiring

  private wireCanvas() {
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.armed) this.updatePlacementPreview(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.ptrStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      if (this.armed) this.updatePlacementPreview(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.canvas.addEventListener('pointerleave', () => {
      if (this.armed) {
        this.renderer.setHover(null, false);
        this.renderer.hideRange();
      }
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.armed) this.disarm();
    });
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.state || this.state.status !== 'playing') {
      this.ptrStart = null;
      return;
    }
    const start = this.ptrStart;
    this.ptrStart = null;

    if (this.armed) {
      this.tryPlaceAt(e.clientX, e.clientY);
      return;
    }

    // selection only counts as a tap (not a camera drag)
    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 0;
    if (moved > 16) return;

    const hex = this.renderer.pickHex(e.clientX, e.clientY);
    if (hex) {
      const t = this.towerAt(hex.q, hex.r);
      if (t) {
        this.selectTower(t.id);
        return;
      }
    }
    this.closeTowerPanel();
  }

  private wireGlobal() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.overlay) {
          if (this.paused) this.resume();
          else this.dismissOverlay();
        } else if (this.armed) {
          this.disarm();
        } else if (this.selectedTowerId !== null) {
          this.closeTowerPanel();
        } else if (this.state && this.state.status === 'playing') {
          this.pause();
        }
      } else if (e.key === ' ' && this.state && this.state.status === 'playing' && !this.overlay) {
        e.preventDefault();
        if (this.paused) this.resume();
        else this.pause();
      }
    });

    const doResize = () => this.renderer.resize();
    window.addEventListener('resize', doResize);
    window.addEventListener('orientationchange', doResize);

    const persist = () => {
      if (this.state && this.state.status === 'playing') {
        writeSave(this.state.mapId, this.state);
      }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persist();
    });
    window.addEventListener('pagehide', persist);
  }

  // ---------------------------------------------------------------- loop

  private loop(now: number) {
    // real elapsed, capped so a hidden/background tab never fast-forwards wildly
    let realDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (realDt > 2) realDt = 2;
    if (realDt < 0) realDt = 0;

    const frameEvents: SimEvent[] = [];
    const s = this.state;
    if (s && this.map && s.status === 'playing' && !this.paused) {
      this.acc += realDt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 8) {
        step(s, this.map);
        for (const ev of s.events) frameEvents.push(ev);
        this.acc -= TICK;
        steps++;
      }
      if (this.acc >= TICK) this.acc = 0; // drop backlog, avoid spiral of death

      // react to wave announcements
      for (const ev of frameEvents) {
        if (ev.type === 'wave') {
          const boss = ev.wave === 10 || ev.wave === 20;
          this.showToast(boss ? `Wave ${ev.wave} — BOSS! 👹` : `Wave ${ev.wave}! 🌸`);
        }
      }

      // status transitions (step() may have mutated s.status; widen past narrowing)
      const cur = s.status as GameState['status'];
      if (cur !== this.prevStatus) {
        this.prevStatus = cur;
        if (cur === 'won') {
          if (!s.endless) clearSave();
          this.showWin();
        } else if (cur === 'lost') {
          clearSave();
          this.showLose();
        }
      }

      // autosave
      if (s.status === 'playing' && s.time - this.lastSaveAt >= SAVE_INTERVAL) {
        this.lastSaveAt = s.time;
        writeSave(s.mapId, s);
      }

      this.updateHud();
    }

    if (s && this.map) {
      this.renderer.render(s, realDt, frameEvents);
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

// Boot
const app = new App();
// keep a handle for debugging
(window as any).__app = app;
