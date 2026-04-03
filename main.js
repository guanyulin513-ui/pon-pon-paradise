/**
 * 崩崩樂園 - Boom Boom Park
 * 核心引擎：Matter.js
 */

const { Engine, Render, Runner, Bodies, Composite, MouseConstraint, Mouse, Vector, Body, Events } = Matter;

// --- 遊戲設定 ---
const COLORS = {
    background: '#F8F9FA',
    blocks: ['#B5EAD7', '#FFDAC1', '#E2F0CB', '#C7CEEA', '#FFB7B2'],
    slingshot: '#6C757D',
    particle: '#FFFFFF'
};

const GAME_STATE = {
    currentLevel: 1,
    ammo: 5,
    maxLevels: 10,
    isMuted: false,
    destroyTarget: 0.8, // 80% 摧毀率過關
    currentWeapon: 'normal',
    totalBlocks: 0,
    destroyedBlocks: 0
};

// --- 初始化物理環境 ---
const engine = Engine.create();
const world = engine.world;
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let width, height;
let runner, slingshot, bodies = [];
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let currentMousePos = { x: 0, y: 0 };
let dyingBodies = []; // 用於實作漸變消失
let particles = [];
let audioCtx, lofiOsc;

// --- 初始化遊戲 ---
function init() {
    resize();
    window.addEventListener('resize', resize);
    
    // 手機觸控防止滾動
    canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    setupInput();
    setupUI();
    loadLevel(1);
    
    runner = Runner.create();
    Runner.run(runner, engine);
    
    // 自定義渲染迴圈 (取代 Matter.Render 以實現 shadowBlur 與消逝效果)
    requestAnimationFrame(render);
}

function resize() {
    width = canvas.width = canvas.offsetWidth;
    height = canvas.height = canvas.offsetHeight;
}

// --- 關卡設計 (共 10 關) ---
function loadLevel(num) {
    Composite.clear(world);
    dyingBodies = [];
    particles = [];
    GAME_STATE.currentLevel = num;
    GAME_STATE.ammo = num <= 3 ? 5 : num <= 7 ? 4 : 3; // 隨難度減少彈藥
    updateUI();

    // 地面
    const ground = Bodies.rectangle(width / 2, height - 10, width, 20, { 
        isStatic: true, 
        render: { fillStyle: '#DEE2E6' } 
    });
    Composite.add(world, ground);

    // 根據關卡生成建築
    createBuilding(num);
}

function createBuilding(level) {
    const startX = width * 0.5;
    const startY = height - 20;
    const blockSize = 30;
    let blockData = [];

    // 簡單的關卡配置邏輯
    if (level === 1) { // 簡單塔
        for(let i=0; i<6; i++) blockData.push({x: startX, y: startY - i*blockSize, w: 40, h: 40});
    } else if (level === 2) { // 雙塔
        for(let i=0; i<4; i++) {
            blockData.push({x: startX - 40, y: startY - i*blockSize, w: 35, h: 35});
            blockData.push({x: startX + 40, y: startY - i*blockSize, w: 35, h: 35});
        }
    } else if (level === 3) { // 拱門
        blockData.push({x: startX - 50, y: startY, w: 20, h: 100}, {x: startX + 50, y: startY, w: 20, h: 100});
        blockData.push({x: startX, y: startY - 110, w: 140, h: 20});
    } else { // 隨機生成複雜結構 (Level 4-10)
        const rows = 3 + Math.floor(level/2);
        const cols = 2 + (level % 3);
        for(let r=0; r<rows; r++) {
            for(let c=0; c<cols; c++) {
                blockData.push({
                    x: startX - (cols*20) + c*45, 
                    y: startY - r*45, 
                    w: 40, h: 40
                });
            }
        }
    }

    GAME_STATE.totalBlocks = blockData.length;
    GAME_STATE.destroyedBlocks = 0;

    blockData.forEach(data => {
        const color = COLORS.blocks[Math.floor(Math.random() * COLORS.blocks.length)];
        const b = Bodies.rectangle(data.x, data.y - data.h/2, data.w, data.h, {
            restitution: 0.3,
            friction: 0.5,
            render: { fillStyle: color, opacity: 1 }
        });
        b.originalPos = { x: data.x, y: data.y };
        b.isBlock = true;
        Composite.add(world, b);
    });
}

// --- 輸入處理 ---
function setupInput() {
    canvas.addEventListener('mousedown', startDrag);
    canvas.addEventListener('mousemove', drag);
    canvas.addEventListener('mouseup', endDrag);
    
    canvas.addEventListener('touchstart', (e) => startDrag(e.touches[0]));
    canvas.addEventListener('touchmove', (e) => drag(e.touches[0]));
    canvas.addEventListener('touchend', endDrag);
}

function startDrag(e) {
    const rect = canvas.getBoundingClientRect();
    isDragging = true;
    dragStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    currentMousePos = { ...dragStart };
    initAudio(); // 啟動音訊
}

function drag(e) {
    if (!isDragging) return;
    const rect = canvas.getBoundingClientRect();
    currentMousePos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function endDrag() {
    if (!isDragging) return;
    isDragging = false;
    
    if (GAME_STATE.ammo <= 0) return;

    // 計算發射向量
    const dx = dragStart.x - currentMousePos.x;
    const dy = dragStart.y - currentMousePos.y;
    const force = Math.min(Vector.magnitude({x: dx, y: dy}) * 0.005, 0.2);
    const angle = Math.atan2(dy, dx);

    shoot(dragStart.x, dragStart.y, angle, force);
}

function shoot(x, y, angle, force) {
    let radius = 15;
    let color = '#FFB7B2';
    let mass = 1;

    if (GAME_STATE.currentWeapon === 'heavy') {
        radius = 25; color = '#A2CFFE'; mass = 5;
    } else if (GAME_STATE.currentWeapon === 'blast') {
        color = '#FFDAC1';
    }

    const bullet = Bodies.circle(x, y, radius, {
        restitution: 0.5,
        mass: mass,
        render: { fillStyle: color }
    });

    bullet.isBullet = true;
    bullet.weaponType = GAME_STATE.currentWeapon;

    Body.applyForce(bullet, bullet.position, {
        x: Math.cos(angle) * force * mass,
        y: Math.sin(angle) * force * mass
    });

    Composite.add(world, bullet);
    GAME_STATE.ammo--;
    playSound('shoot');
    updateUI();

    // 爆裂彈特殊邏輯：3秒後或碰撞後爆炸
    if (GAME_STATE.currentWeapon === 'blast') {
        setTimeout(() => explode(bullet), 1500);
    }
}

function explode(bullet) {
    if (!bullet.world) return; // 已被移除
    const blastRadius = 150;
    const bodiesInRange = Matter.Query.circle(Composite.allBodies(world), bullet.position, blastRadius);
    
    bodiesInRange.forEach(b => {
        if (!b.isStatic) {
            const forceVec = Vector.sub(b.position, bullet.position);
            const dist = Vector.magnitude(forceVec);
            const forceMag = (1 - dist/blastRadius) * 0.05;
            Body.applyForce(b, b.position, Vector.mult(Vector.normalise(forceVec), forceMag));
        }
    });

    spawnParticles(bullet.position.x, bullet.position.y, '#FFDAC1', 20);
    shakeCamera();
    playSound('blast');
    Composite.remove(world, bullet);
}

// --- 渲染與特效 ---
function render() {
    ctx.clearRect(0, 0, width, height);
    
    // 繪製瞄準虛線
    if (isDragging) {
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(dragStart.x, dragStart.y);
        ctx.lineTo(currentMousePos.x, currentMousePos.y);
        ctx.strokeStyle = 'rgba(0,0,0,0.2)';
        ctx.stroke();
        ctx.setLineDash([]);
    }

    const allBodies = Composite.allBodies(world);
    
    // 物理體渲染
    allBodies.forEach(body => {
        if (body.label === 'Rectangle Body' || body.label === 'Circle Body') {
            const { x, y } = body.position;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(body.angle);
            
            ctx.fillStyle = body.render.fillStyle || '#000';
            ctx.globalAlpha = body.render.opacity || 1;
            
            // 視覺特效：陰影與圓角
            ctx.shadowBlur = 10;
            ctx.shadowColor = 'rgba(0,0,0,0.1)';
            ctx.shadowOffsetY = 4;

            if (body.circleRadius) {
                ctx.beginPath();
                ctx.arc(0, 0, body.circleRadius, 0, Math.PI * 2);
                ctx.fill();
            } else {
                const w = body.bounds.max.x - body.bounds.min.x;
                const h = body.bounds.max.y - body.bounds.min.y;
                drawRoundedRect(ctx, -w/2, -h/2, w, h, 8);
            }
            ctx.restore();

            // 判斷是否掉落並觸發漸變消逝
            if (!body.isStatic && y > height - 50 && !body.isDying && body.isBlock) {
                body.isDying = true;
                dyingBodies.push(body);
                GAME_STATE.destroyedBlocks++;
                checkProgress();
            }
        }
    });

    // 處理消逝中的物體
    for (let i = dyingBodies.length - 1; i >= 0; i--) {
        const b = dyingBodies[i];
        b.render.opacity -= 0.02;
        if (b.render.opacity <= 0) {
            Composite.remove(world, b);
            dyingBodies.splice(i, 1);
        }
    }

    // 繪製粒子
    updateParticles();

    requestAnimationFrame(render);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closeSubpath();
    ctx.fill();
}

// --- 遊戲邏輯回饋 ---
function checkProgress() {
    const percent = Math.min((GAME_STATE.destroyedBlocks / GAME_STATE.totalBlocks) * 100, 100);
    document.getElementById('destroy-progress').style.width = percent + '%';

    if (percent >= 80) {
        setTimeout(winLevel, 1000);
    } else if (GAME_STATE.ammo <= 0 && dyingBodies.length === 0) {
        setTimeout(failLevel, 2000);
    }
}

function winLevel() {
    if (GAME_STATE.currentLevel >= GAME_STATE.maxLevels) {
        showOverlay('通關大吉！', '你摧毀了所有的樂園！', '重新挑戰');
        GAME_STATE.currentLevel = 1;
    } else {
        showOverlay('大成功！', `第 ${GAME_STATE.currentLevel} 關已拆除`, '進入下一關');
        GAME_STATE.currentLevel++;
    }
    playSound('win');
}

function failLevel() {
    showOverlay('可惜！', '結構依然穩固，再試一次？', '重新開始');
    playSound('fail');
}

// --- 音效系統 (Web Audio API) ---
function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // 簡單的 Lofi 背景音 (Oscillator)
    lofiOsc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    lofiOsc.type = 'sine';
    lofiOsc.frequency.setValueAtTime(110, audioCtx.currentTime); 
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    lofiOsc.connect(gain);
    gain.connect(audioCtx.destination);
    lofiOsc.start();
}

function playSound(type) {
    if (GAME_STATE.isMuted || !audioCtx) return;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.connect(g);
    g.connect(audioCtx.destination);

    if (type === 'shoot') {
        osc.frequency.setTargetAtTime(400, audioCtx.currentTime, 0.1);
        osc.frequency.setTargetAtTime(100, audioCtx.currentTime + 0.05, 0.1);
        g.gain.setValueAtTime(0.2, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
    } else if (type === 'blast') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(100, audioCtx.currentTime);
        g.gain.setValueAtTime(0.5, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    } else if (type === 'win') {
        osc.frequency.setValueAtTime(523, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.3);
        g.gain.setValueAtTime(0.2, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    }
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
}

// --- UI 控制 ---
function setupUI() {
    document.getElementById('start-btn').onclick = () => {
        document.getElementById('overlay').classList.add('hidden');
        loadLevel(GAME_STATE.currentLevel);
    };

    document.querySelectorAll('.weapon-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.weapon-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            GAME_STATE.currentWeapon = btn.dataset.type;
        };
    });

    document.getElementById('mute-btn').onclick = () => {
        GAME_STATE.isMuted = !GAME_STATE.isMuted;
        document.getElementById('mute-btn').innerText = GAME_STATE.isMuted ? '🔇' : '🔊';
    };
}

function updateUI() {
    document.getElementById('level-num').innerText = GAME_STATE.currentLevel;
    document.getElementById('ammo-count').innerText = GAME_STATE.ammo;
    document.getElementById('destroy-progress').style.width = '0%';
}

function showOverlay(title, desc, btnText) {
    const over = document.getElementById('overlay');
    document.getElementById('overlay-title').innerText = title;
    document.getElementById('overlay-desc').innerText = desc;
    document.getElementById('start-btn').innerText = btnText;
    over.classList.remove('hidden');
}

// --- 特效輔助 ---
function spawnParticles(x, y, color, count) {
    for (let i = 0; i < count; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1.0,
            color: color
        });
    }
}

function updateParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) {
            particles.splice(i, 1);
            continue;
        }
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

function shakeCamera() {
    canvas.style.transform = `translate(${(Math.random()-0.5)*10}px, ${(Math.random()-0.5)*10}px)`;
    setTimeout(() => canvas.style.transform = 'translate(0,0)', 100);
}

// 啟動遊戲
init();
