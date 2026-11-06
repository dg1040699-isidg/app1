/**
 * 神射巔峰：雙人弓箭對決 (Archery Masters: 2-Player Showdown)
 * Core Physics Engine & Game Controller
 */

// Game Constants
const GRAVITY = 980; // pixels / s^2
const MAX_POWER_SPEED = 1200; // max initial launch speed
const ARROW_LENGTH = 54;

class ArcheryGame {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.targetCamCanvas = document.getElementById('targetCamCanvas');
        this.targetCamCtx = this.targetCamCanvas ? this.targetCamCanvas.getContext('2d') : null;

        // Game Settings
        this.mode = 'target'; // 'target', 'duel', 'practice'
        this.totalRounds = 3;
        this.currentRound = 1;
        this.arrowsPerRound = 3;
        this.windDifficulty = 'medium';
        this.showTrajectory = true;
        this.targetMotion = 'static'; // 'static', 'moving'

        // Players State
        this.activePlayer = 1; // 1 or 2
        this.players = {
            1: {
                id: 1,
                name: '烈焰遊俠 (P1)',
                color: '#ff334b',
                trailColor: '#ff7844',
                score: 0,
                hp: 100,
                arrowsLeft: 3,
                roundScores: [],
                streak: 0,
                bullseyes: 0,
                headshots: 0,
                x: 220,
                y: 500,
                facing: 1 // 1: right, -1: left
            },
            2: {
                id: 2,
                name: '霜風守望 (P2)',
                color: '#00d2ff',
                trailColor: '#00ffff',
                score: 0,
                hp: 100,
                arrowsLeft: 3,
                roundScores: [],
                streak: 0,
                bullseyes: 0,
                headshots: 0,
                x: 1400,
                y: 500,
                facing: -1
            }
        };

        // Environment & Wind
        this.wind = { x: 0, speed: 0, maxSpeed: 6.0 };
        this.camera = { x: 0, y: 0, zoom: 1, targetX: 0, targetY: 0 };
        this.shake = { x: 0, y: 0, intensity: 0 };

        // Aiming State
        this.isAiming = false;
        this.aimStart = { x: 0, y: 0 };
        this.aimCurrent = { x: 0, y: 0 };
        this.aimAngle = 45; // degrees
        this.aimPower = 0; // 0 to 1
        this.keyboardCharging = false;
        this.keyboardChargeStart = 0;

        // World Objects
        this.arrows = [];
        this.activeArrow = null;
        this.target = {
            x: 1350,
            y: 480,
            radius: 80,
            vy: 80,
            minY: 340,
            maxY: 600
        };
        this.particles = [];
        this.floatingTexts = [];
        this.targetHitsHistory = []; // for Mini Target Cam

        // Assets
        this.bgImages = {
            arena: new Image(),
            duel: new Image()
        };
        this.bgImages.arena.src = 'assets/archery_arena_bg.jpg';
        this.bgImages.duel.src = 'assets/archery_duel_bg.jpg';

        // Timing
        this.lastTime = performance.now();
        this.isTurnTransitioning = false;
        this.isGameOver = false;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.setupEventListeners();
        this.setupUIBindings();
        this.applySettings();
        this.resetMatch();

        requestAnimationFrame((t) => this.loop(t));
    }

    resize() {
        const dpr = window.devicePixelRatio || 1;
        this.width = window.innerWidth;
        this.height = window.innerHeight;

        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        // Position ground & targets dynamically based on screen
        this.groundY = Math.min(this.height - 100, Math.max(480, this.height * 0.78));

        // Adjust player positions
        this.players[1].x = Math.max(180, this.width * 0.16);
        this.players[1].y = this.groundY;

        if (this.mode === 'duel') {
            this.players[2].x = Math.min(this.width - 180, this.width * 0.84);
            this.players[2].y = this.groundY;
        } else {
            // Target mode: P1 and P2 stand at the same shooting line!
            this.players[2].x = this.players[1].x;
            this.players[2].y = this.groundY;
            this.target.x = Math.min(this.width - 160, this.width * 0.84);
            this.target.y = this.groundY - 60;
        }

        this.camera.targetX = this.players[this.activePlayer].x;
        this.camera.targetY = this.players[this.activePlayer].y - 80;
    }

    setupEventListeners() {
        // Mouse / Touch Aiming
        const getCanvasPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: clientX - rect.left,
                y: clientY - rect.top
            };
        };

        const onPointerDown = (e) => {
            if (this.isGameOver || this.isTurnTransitioning || this.activeArrow) return;
            window.soundCtrl.ensureContext();

            const pos = getCanvasPos(e);
            const p = this.players[this.activePlayer];
            const archerScreenPos = this.worldToScreen(p.x, p.y - 45);

            // Distance to current active archer - generous hit area for touch/mouse
            const dist = Math.hypot(pos.x - archerScreenPos.x, pos.y - archerScreenPos.y);
            if (dist < 320) {
                this.isAiming = true;
                this.aimStart = pos;
                this.aimCurrent = pos;
                this.updateAimVector();
            }
        };

        const onPointerMove = (e) => {
            if (!this.isAiming) return;
            this.aimCurrent = getCanvasPos(e);
            this.updateAimVector();
        };

        const onPointerUp = () => {
            if (!this.isAiming) return;
            this.isAiming = false;
            if (this.aimPower > 0.08) {
                this.shootCurrentArrow();
            } else {
                this.aimPower = 0;
                this.updateHUD();
            }
        };

        this.canvas.addEventListener('mousedown', onPointerDown);
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('mouseup', onPointerUp);

        this.canvas.addEventListener('touchstart', onPointerDown, { passive: true });
        window.addEventListener('touchmove', onPointerMove, { passive: true });
        window.addEventListener('touchend', onPointerUp);

        // Keyboard Controls
        window.addEventListener('keydown', (e) => {
            if (this.isGameOver || this.isTurnTransitioning || this.activeArrow) return;

            if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
                this.aimAngle = Math.min(85, this.aimAngle + 1);
                this.updateHUD();
            } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
                this.aimAngle = Math.max(-20, this.aimAngle - 1);
                this.updateHUD();
            } else if (e.key === ' ' || e.code === 'Space') {
                if (!this.keyboardCharging) {
                    this.keyboardCharging = true;
                    this.keyboardChargeStart = performance.now();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.key === ' ' || e.code === 'Space') {
                if (this.keyboardCharging) {
                    this.keyboardCharging = false;
                    if (this.aimPower > 0.08) {
                        this.shootCurrentArrow();
                    }
                }
            }
        });
    }

    updateAimVector() {
        const p = this.players[this.activePlayer];
        const archerScreenPos = this.worldToScreen(p.x, p.y - 45);

        // Vector from mouse back to archer (pull back mechanic)
        const dx = archerScreenPos.x - this.aimCurrent.x;
        const dy = archerScreenPos.y - this.aimCurrent.y;

        const pullDist = Math.hypot(dx, dy);
        const maxPull = 150;
        this.aimPower = Math.min(1.0, pullDist / maxPull);

        // Aim angle in degrees
        let rad = Math.atan2(-dy, dx * p.facing);
        this.aimAngle = (rad * 180) / Math.PI;

        // Sound feedback on drawing bow
        if (Math.random() < 0.12 && this.aimPower > 0.1) {
            window.soundCtrl.playBowDraw(this.aimPower);
        }

        this.updateHUD();
    }

    shootCurrentArrow() {
        const p = this.players[this.activePlayer];
        const speed = this.aimPower * MAX_POWER_SPEED;
        const rad = (this.aimAngle * Math.PI) / 180;

        const vx = Math.cos(rad) * speed * p.facing;
        const vy = -Math.sin(rad) * speed;

        const arrow = {
            playerId: p.id,
            x: p.x + p.facing * 30,
            y: p.y - 45,
            vx: vx,
            vy: vy,
            angle: Math.atan2(vy, vx),
            isFlying: true,
            isStuck: false,
            trail: [],
            length: ARROW_LENGTH,
            stuckTarget: null,
            stuckOffset: { x: 0, y: 0 }
        };

        this.arrows.push(arrow);
        this.activeArrow = arrow;
        p.arrowsLeft--;

        window.soundCtrl.playArrowShoot();

        // Screen micro-shake on release
        this.addScreenShake(3);

        // Spawn release dust / spark particles
        for (let i = 0; i < 10; i++) {
            this.particles.push({
                x: arrow.x,
                y: arrow.y,
                vx: (Math.random() - 0.5) * 80 + p.facing * 40,
                vy: (Math.random() - 0.5) * 80,
                radius: Math.random() * 3 + 1,
                color: p.trailColor,
                alpha: 1,
                decay: 0.05
            });
        }

        this.updateHUD();
    }

    generateWind() {
        let max = 3.0;
        if (this.windDifficulty === 'calm') max = 1.2;
        if (this.windDifficulty === 'storm') max = 8.5;

        // Random wind from -max to +max
        const windVal = (Math.random() * 2 - 1) * max;
        this.wind.speed = Math.abs(windVal);
        this.wind.direction = windVal >= 0 ? 1 : -1;
        this.wind.x = windVal * 75; // force applied to arrow vx

        // Update UI wind compass
        const windArrow = document.getElementById('windArrow');
        const windArrowBox = document.getElementById('windArrowBox');
        const windSpeedText = document.getElementById('windSpeed');

        if (windArrowBox) {
            windArrowBox.style.transform = `rotate(${this.wind.direction > 0 ? 0 : 180}deg)`;
        }
        if (windSpeedText) {
            windSpeedText.textContent = `${this.wind.speed.toFixed(1)} m/s`;
        }
    }

    nextTurn() {
        if (this.isGameOver) return;
        this.isTurnTransitioning = true;
        this.activeArrow = null;

        setTimeout(() => {
            // Check round completion in target mode
            if (this.mode === 'target') {
                if (this.players[1].arrowsLeft <= 0 && this.players[2].arrowsLeft <= 0) {
                    if (this.currentRound >= this.totalRounds) {
                        this.handleGameOver();
                        return;
                    } else {
                        // Advance to next round
                        this.currentRound++;
                        this.players[1].arrowsLeft = this.arrowsPerRound;
                        this.players[2].arrowsLeft = this.arrowsPerRound;
                        this.arrows = []; // Clear field arrows for fresh round
                        this.targetHitsHistory = [];
                        this.drawTargetCam();
                    }
                }
            }

            // In practice or duel mode, reload arrow
            if (this.mode === 'practice') {
                this.players[1].arrowsLeft = 3;
            } else if (this.mode === 'duel') {
                this.players[1].arrowsLeft = 3;
                this.players[2].arrowsLeft = 3;
            }

            // Switch active player (unless in practice mode)
            if (this.mode !== 'practice') {
                this.activePlayer = this.activePlayer === 1 ? 2 : 1;
            }

            // Generate dynamic wind for each turn
            this.generateWind();

            // Smooth camera to active player
            const p = this.players[this.activePlayer];
            this.camera.targetX = p.x;
            this.camera.targetY = p.y - 80;

            // Announce turn
            this.showTurnBanner(`${p.name} 準備射擊！`);

            this.isTurnTransitioning = false;
            this.updateHUD();
        }, 1200);
    }

    showTurnBanner(text) {
        const banner = document.getElementById('turnBanner');
        if (banner) {
            banner.textContent = text;
            banner.classList.add('show');
            setTimeout(() => {
                banner.classList.remove('show');
            }, 1800);
        }
    }

    addScreenShake(intensity) {
        this.shake.intensity = Math.max(this.shake.intensity, intensity);
    }

    addFloatingText(text, x, y, color = '#ffd700', fontSize = 24) {
        this.floatingTexts.push({
            text,
            x,
            y,
            color,
            fontSize,
            alpha: 1,
            vy: -45,
            lifetime: 1.4
        });
    }

    handleTargetHit(arrow) {
        arrow.isFlying = false;
        arrow.isStuck = true;

        // Calculate distance to target center
        const dx = arrow.x - this.target.x;
        const dy = arrow.y - this.target.y;
        const dist = Math.hypot(dx, dy);

        let points = 0;
        let label = 'MISS';
        let color = '#94a3b8';

        // 10 Rings scoring (radius 80)
        const rRatio = dist / this.target.radius;

        if (rRatio <= 0.12) {
            points = 10;
            label = '🎯 黃心 X-RING! +10';
            color = '#fbbf24';
            this.players[this.activePlayer].bullseyes++;
            this.addScreenShake(12);
        } else if (rRatio <= 0.25) {
            points = 10;
            label = '🎯 命中黃心! +10';
            color = '#f59e0b';
            this.players[this.activePlayer].bullseyes++;
            this.addScreenShake(10);
        } else if (rRatio <= 0.45) {
            points = 8;
            label = '紅心區! +8';
            color = '#ef4444';
            this.addScreenShake(7);
        } else if (rRatio <= 0.65) {
            points = 6;
            label = '藍圈區! +6';
            color = '#3b82f6';
            this.addScreenShake(5);
        } else if (rRatio <= 0.85) {
            points = 4;
            label = '黑圈區! +4';
            color = '#64748b';
            this.addScreenShake(4);
        } else if (rRatio <= 1.05) {
            points = 2;
            label = '白圈邊緣! +2';
            color = '#e2e8f0';
            this.addScreenShake(3);
        } else {
            label = '脫靶 MISS!';
            color = '#ef4444';
        }

        const player = this.players[this.activePlayer];
        player.score += points;

        if (points >= 8) {
            player.streak++;
        } else {
            player.streak = 0;
        }

        // Attach to target so it moves with it if target is oscillating
        arrow.stuckTarget = this.target;
        arrow.stuckOffset = { x: arrow.x - this.target.x, y: arrow.y - this.target.y };

        // Record for Mini Target Cam
        this.targetHitsHistory.push({
            dx: dx,
            dy: dy,
            points: points,
            color: player.color
        });
        this.drawTargetCam();

        // Audio
        window.soundCtrl.playTargetHit(points);

        // Visual effects
        this.addFloatingText(label, arrow.x, arrow.y - 30, color, points >= 10 ? 30 : 24);

        // Spawn hit wood splinters & spark particles
        for (let i = 0; i < (points >= 8 ? 20 : 10); i++) {
            this.particles.push({
                x: arrow.x,
                y: arrow.y,
                vx: (Math.random() - 0.5) * 160,
                vy: (Math.random() - 0.5) * 160,
                radius: Math.random() * 3.5 + 1.5,
                color: points >= 9 ? '#ffd700' : '#e2ba86',
                alpha: 1,
                decay: 0.04
            });
        }

        this.updateHUD();
        this.nextTurn();
    }

    handlePlayerHit(arrow, targetPlayer) {
        arrow.isFlying = false;
        arrow.isStuck = true;

        const shooter = this.players[this.activePlayer];
        const dyFromCenter = arrow.y - (targetPlayer.y - 45); // character height ~70

        let damage = 25;
        let isHeadshot = false;
        let label = '-25 HP';

        if (dyFromCenter < -20) {
            // Head hit zone
            damage = 45;
            isHeadshot = true;
            label = '💥 暴擊爆頭 HEADSHOT! -45 HP';
            shooter.headshots++;
            this.addScreenShake(16);
        } else if (dyFromCenter > 20) {
            // Legs
            damage = 15;
            label = '-15 HP (腿部)';
            this.addScreenShake(6);
        } else {
            // Torso
            damage = 25;
            label = '-25 HP (身體)';
            this.addScreenShake(8);
        }

        targetPlayer.hp = Math.max(0, targetPlayer.hp - damage);
        shooter.score += damage;

        window.soundCtrl.playDamageHit(isHeadshot);
        this.addFloatingText(label, targetPlayer.x, targetPlayer.y - 70, isHeadshot ? '#ef4444' : '#f59e0b', isHeadshot ? 28 : 22);

        // Blood / Energy impact particles
        for (let i = 0; i < 24; i++) {
            this.particles.push({
                x: arrow.x,
                y: arrow.y,
                vx: (Math.random() - 0.5) * 180,
                vy: (Math.random() - 0.5) * 180,
                radius: Math.random() * 4 + 2,
                color: targetPlayer.color,
                alpha: 1,
                decay: 0.03
            });
        }

        // Attach to hit character
        arrow.stuckTarget = targetPlayer;
        arrow.stuckOffset = { x: arrow.x - targetPlayer.x, y: arrow.y - targetPlayer.y };

        this.updateHUD();

        if (targetPlayer.hp <= 0) {
            this.handleGameOver();
        } else {
            this.nextTurn();
        }
    }

    handleGroundHit(arrow) {
        arrow.isFlying = false;
        arrow.isStuck = true;
        arrow.y = this.groundY;

        window.soundCtrl.playTargetHit(0);
        this.addFloatingText('MISS (觸地)', arrow.x, this.groundY - 15, '#94a3b8', 18);
        this.addScreenShake(4);

        // Dirt particles
        for (let i = 0; i < 8; i++) {
            this.particles.push({
                x: arrow.x,
                y: this.groundY,
                vx: (Math.random() - 0.5) * 100,
                vy: -Math.random() * 80,
                radius: Math.random() * 3 + 1,
                color: '#65a30d',
                alpha: 1,
                decay: 0.05
            });
        }

        this.players[this.activePlayer].streak = 0;
        this.updateHUD();
        this.nextTurn();
    }

    handleGameOver() {
        this.isGameOver = true;
        window.soundCtrl.playVictory();

        // Spawn glorious confetti
        this.spawnConfetti();

        const p1 = this.players[1];
        const p2 = this.players[2];

        let winnerText = '';
        let winnerSubtitle = '';
        let winnerBadge = '🏆';

        if (this.mode === 'duel') {
            if (p1.hp > p2.hp) {
                winnerText = `🔥 ${p1.name} 勇奪勝利！`;
                winnerSubtitle = `${p2.name} 倒下了，榮耀歸於烈焰領主！`;
            } else if (p2.hp > p1.hp) {
                winnerText = `❄️ ${p2.name} 勇奪勝利！`;
                winnerSubtitle = `${p1.name} 倒下了，榮耀歸於霜雪遊俠！`;
            } else {
                winnerText = '雙雄同歸於盡！平手！';
                winnerSubtitle = '勢均力敵的終極史詩決戰！';
                winnerBadge = '⚔️';
            }
        } else {
            if (p1.score > p2.score) {
                winnerText = `🔥 ${p1.name} 榮登神射榜首！`;
                winnerSubtitle = `總分領先 ${p1.score - p2.score} 分，百步穿楊！`;
            } else if (p2.score > p1.score) {
                winnerText = `❄️ ${p2.name} 榮登神射榜首！`;
                winnerSubtitle = `總分領先 ${p2.score - p1.score} 分，百步穿楊！`;
            } else {
                winnerText = '同分平手！不相上下！';
                winnerSubtitle = `兩位神射手均斬獲 ${p1.score} 分！`;
                winnerBadge = '🤝';
            }
        }

        const victoryModal = document.getElementById('victoryModal');
        document.getElementById('winnerBadge').textContent = winnerBadge;
        document.getElementById('winnerTitle').textContent = winnerText;
        document.getElementById('winnerSubtitle').textContent = winnerSubtitle;

        document.getElementById('finalP1Score').textContent = this.mode === 'duel' ? `${p1.hp} HP (得分 ${p1.score})` : `${p1.score} 分`;
        document.getElementById('finalP2Score').textContent = this.mode === 'duel' ? `${p2.hp} HP (得分 ${p2.score})` : `${p2.score} 分`;
        document.getElementById('finalBestHit').textContent = this.mode === 'duel' ? `暴擊爆頭次數: P1(${p1.headshots}) vs P2(${p2.headshots})` : `黃心命中: P1(${p1.bullseyes}) vs P2(${p2.bullseyes})`;

        victoryModal.classList.remove('hidden');
    }

    spawnConfetti() {
        const colors = ['#f59e0b', '#ef4444', '#06b6d4', '#10b981', '#ec4899', '#ffffff'];
        for (let i = 0; i < 150; i++) {
            this.particles.push({
                x: this.width * Math.random(),
                y: -20 - Math.random() * 200,
                vx: (Math.random() - 0.5) * 120,
                vy: Math.random() * 200 + 100,
                radius: Math.random() * 5 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                alpha: 1,
                decay: 0.005,
                isConfetti: true,
                rotation: Math.random() * 360,
                rotSpeed: (Math.random() - 0.5) * 10
            });
        }
    }

    drawTargetCam() {
        if (!this.targetCamCtx) return;
        const ctx = this.targetCamCtx;
        const w = 160;
        const h = 160;
        const cx = w / 2;
        const cy = h / 2;
        const scale = 0.85;

        ctx.clearRect(0, 0, w, h);

        // Outer rim
        ctx.fillStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(cx, cy, 75 * scale, 0, Math.PI * 2);
        ctx.fill();

        // 10 Olympic Rings
        const rings = [
            { r: 72 * scale, color: '#f8fafc' }, // White outer
            { r: 58 * scale, color: '#334155' }, // Black
            { r: 44 * scale, color: '#0284c7' }, // Blue
            { r: 30 * scale, color: '#dc2626' }, // Red
            { r: 16 * scale, color: '#facc15' }, // Gold / Yellow
            { r: 7 * scale, color: '#eab308' }   // X-Ring
        ];

        rings.forEach(ring => {
            ctx.fillStyle = ring.color;
            ctx.beginPath();
            ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Center crosshair
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.beginPath();
        ctx.moveTo(cx - 8, cy); ctx.lineTo(cx + 8, cy);
        ctx.moveTo(cx, cy - 8); ctx.lineTo(cx, cy + 8);
        ctx.stroke();

        // Draw recorded arrow pin hits
        this.targetHitsHistory.forEach(hit => {
            const pinX = cx + (hit.dx / this.target.radius) * (70 * scale);
            const pinY = cy + (hit.dy / this.target.radius) * (70 * scale);

            // Pin shadow
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.beginPath();
            ctx.arc(pinX + 1, pinY + 1, 4, 0, Math.PI * 2);
            ctx.fill();

            // Pin head
            ctx.fillStyle = hit.color;
            ctx.beginPath();
            ctx.arc(pinX, pinY, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
    }

    updatePhysics(dt) {
        // Keyboard charge accumulation
        if (this.keyboardCharging) {
            const elapsed = (performance.now() - this.keyboardChargeStart) / 1000;
            this.aimPower = Math.min(1.0, elapsed * 0.9);
            this.updateHUD();
        }

        // Target movement
        if (this.mode === 'target' && this.targetMotion === 'moving') {
            this.target.y += this.target.vy * dt;
            if (this.target.y > this.target.maxY) {
                this.target.y = this.target.maxY;
                this.target.vy *= -1;
            } else if (this.target.y < this.target.minY) {
                this.target.y = this.target.minY;
                this.target.vy *= -1;
            }
        }

        // Screen Shake decay
        if (this.shake.intensity > 0) {
            this.shake.x = (Math.random() - 0.5) * this.shake.intensity;
            this.shake.y = (Math.random() - 0.5) * this.shake.intensity;
            this.shake.intensity = Math.max(0, this.shake.intensity - dt * 25);
        } else {
            this.shake.x = 0;
            this.shake.y = 0;
        }

        // Active Flying Arrow Physics
        if (this.activeArrow && this.activeArrow.isFlying) {
            const arr = this.activeArrow;

            // Wind effect on horizontal velocity
            arr.vx += this.wind.x * dt;
            // Gravity on vertical velocity
            arr.vy += GRAVITY * dt;

            // Update position
            arr.x += arr.vx * dt;
            arr.y += arr.vy * dt;
            arr.angle = Math.atan2(arr.vy, arr.vx);

            // Record trail
            arr.trail.push({ x: arr.x, y: arr.y, alpha: 1.0 });
            if (arr.trail.length > 25) arr.trail.shift();

            // Camera smoothly tracks flying arrow!
            this.camera.targetX = arr.x;
            this.camera.targetY = arr.y;

            // Collision check with Target (in target/practice mode)
            const prevX = arr.x - arr.vx * dt;
            const prevY = arr.y - arr.vy * dt;

            if (this.mode !== 'duel') {
                const targetFrontX = this.target.x - 10;
                const crossedTarget = (prevX <= targetFrontX && arr.x >= targetFrontX) || 
                                     (arr.x >= targetFrontX && arr.x <= this.target.x + 50);
                if (arr.vx > 0 && crossedTarget) {
                    if (Math.abs(arr.y - this.target.y) <= this.target.radius + 15) {
                        this.handleTargetHit(arr);
                    }
                }
            } else {
                // Collision check with Target Player (in duel mode)
                const opponentId = arr.playerId === 1 ? 2 : 1;
                const opp = this.players[opponentId];
                const hitDist = Math.hypot(arr.x - opp.x, arr.y - (opp.y - 45));
                const prevHitDist = Math.hypot(prevX - opp.x, prevY - (opp.y - 45));

                if (hitDist < 42 || (prevHitDist < 60 && hitDist < 60)) {
                    this.handlePlayerHit(arr, opp);
                }
            }

            // Ground Collision
            if (arr.isFlying && arr.y >= this.groundY) {
                this.handleGroundHit(arr);
            }

            // Out of bounds safety
            if (arr.isFlying && (arr.x > this.width + 400 || arr.x < -200 || arr.y > this.height + 200)) {
                arr.isFlying = false;
                this.addFloatingText('OUT OF BOUNDS', this.width / 2, this.groundY - 100, '#ef4444', 24);
                this.nextTurn();
            }
        }

        // Attached stuck arrows follow their moving target
        this.arrows.forEach(arr => {
            if (arr.isStuck && arr.stuckTarget) {
                arr.x = arr.stuckTarget.x + arr.stuckOffset.x;
                arr.y = arr.stuckTarget.y + arr.stuckOffset.y;
            }
        });

        // Particles update
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.alpha -= p.decay;
            if (p.isConfetti) {
                p.rotation += p.rotSpeed;
                p.vy += 40 * dt; // gravity
            }
            if (p.alpha <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Floating texts update
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.y += ft.vy * dt;
            ft.lifetime -= dt;
            ft.alpha = Math.max(0, ft.lifetime / 1.4);
            if (ft.lifetime <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // Camera smooth interpolation (Lerp)
        const lerpFactor = 0.08;
        this.camera.x += (this.camera.targetX - this.camera.x) * lerpFactor;
        this.camera.y += (this.camera.targetY - this.camera.y) * lerpFactor;
    }

    worldToScreen(x, y) {
        // Center camera in viewport
        const screenX = x - (this.camera.x - this.width / 2) + this.shake.x;
        const screenY = y - (this.camera.y - this.height / 2) + this.shake.y;
        return { x: screenX, y: screenY };
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        // 1. Draw Background Image with Parallax
        const bgImg = this.mode === 'duel' ? this.bgImages.duel : this.bgImages.arena;
        if (bgImg.complete && bgImg.naturalWidth !== 0) {
            const parallaxX = -(this.camera.x - this.width / 2) * 0.15;
            const parallaxY = -(this.camera.y - this.height / 2) * 0.1;
            ctx.drawImage(bgImg, parallaxX - 60, parallaxY - 40, this.width + 120, this.height + 80);
        } else {
            // High aesthetic fallback gradient
            const grad = ctx.createLinearGradient(0, 0, 0, this.height);
            grad.addColorStop(0, '#0f172a');
            grad.addColorStop(1, '#020617');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.width, this.height);
        }

        // 2. Draw Scenic Ground
        const groundPos = this.worldToScreen(0, this.groundY);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(0, groundPos.y, this.width, this.height - groundPos.y);

        // Ground Grass/Platform Border
        ctx.strokeStyle = '#22c55e';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, groundPos.y);
        ctx.lineTo(this.width, groundPos.y);
        ctx.stroke();

        // 3. Draw Target (in target/practice mode)
        if (this.mode !== 'duel') {
            this.drawTarget(ctx);
        }

        // 4. Draw Archers
        if (this.mode === 'duel') {
            this.drawArcher(ctx, this.players[1]);
            this.drawArcher(ctx, this.players[2]);
        } else {
            // Draw active player on the shooting pad
            this.drawArcher(ctx, this.players[this.activePlayer]);
        }

        // 5. Draw Trajectory Assistance Line if aiming
        if (this.isAiming && this.showTrajectory) {
            this.drawTrajectoryPreview(ctx);
        }

        // 6. Draw Arrows & Sticking Arrows
        this.arrows.forEach(arrow => this.drawArrow(ctx, arrow));

        // 7. Draw Particles & Confetti
        this.drawParticles(ctx);

        // 8. Draw Floating Texts
        this.drawFloatingTexts(ctx);
    }

    drawTarget(ctx) {
        const pos = this.worldToScreen(this.target.x, this.target.y);
        const r = this.target.radius;

        ctx.save();
        ctx.translate(pos.x, pos.y);

        // Target Wooden Stand / Tripod Legs
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(-10, 0); ctx.lineTo(-24, this.groundY - this.target.y);
        ctx.moveTo(10, 0); ctx.lineTo(24, this.groundY - this.target.y);
        ctx.moveTo(0, 0); ctx.lineTo(0, this.groundY - this.target.y + 10);
        ctx.stroke();

        // 10 Rings Target Boss
        const rings = [
            { r: r, color: '#f8fafc' }, // 1-2 White
            { r: r * 0.8, color: '#1e293b' }, // 3-4 Black
            { r: r * 0.6, color: '#0284c7' }, // 5-6 Blue
            { r: r * 0.4, color: '#dc2626' }, // 7-8 Red
            { r: r * 0.2, color: '#facc15' }, // 9-10 Yellow
            { r: r * 0.08, color: '#eab308' } // X-Ring
        ];

        rings.forEach(ring => {
            ctx.fillStyle = ring.color;
            ctx.beginPath();
            ctx.arc(0, 0, ring.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });

        // Golden Outer Rim
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    }

    drawArcher(ctx, player) {
        const pos = this.worldToScreen(player.x, player.y);
        const isCurrentShooter = player.id === this.activePlayer && !this.activeArrow;

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.scale(player.facing, 1);

        // Shadow under archer
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.beginPath();
        ctx.ellipse(0, 0, 24, 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // Legs
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-10, -32); ctx.lineTo(-14, 0);
        ctx.moveTo(8, -32); ctx.lineTo(12, 0);
        ctx.stroke();

        // Torso / Tunic with team color
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.roundRect(-14, -64, 28, 34, [6, 6, 2, 2]);
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Quiver on back with arrows
        ctx.fillStyle = '#78350f';
        ctx.save();
        ctx.rotate(-0.2);
        ctx.fillRect(-22, -62, 10, 28);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        for (let i = 0; i < Math.max(1, player.arrowsLeft); i++) {
            ctx.beginPath();
            ctx.moveTo(-20 + i * 3, -62);
            ctx.lineTo(-24 + i * 3, -76);
            ctx.stroke();
        }
        ctx.restore();

        // Head & Hood
        ctx.fillStyle = player.color;
        ctx.beginPath();
        ctx.arc(0, -74, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Face opening
        ctx.fillStyle = '#fed7aa';
        ctx.beginPath();
        ctx.arc(4, -73, 9, 0, Math.PI * 2);
        ctx.fill();

        // Eye
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(6, -74, 2, 0, Math.PI * 2);
        ctx.fill();

        // Bow & Aiming Arms
        const aimRad = (this.aimAngle * Math.PI) / 180;
        const armPivotY = -52;

        ctx.save();
        ctx.translate(6, armPivotY);
        ctx.rotate(isCurrentShooter ? -aimRad : 0);

        // Extended front arm holding bow
        ctx.strokeStyle = '#fed7aa';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(26, 0);
        ctx.stroke();

        // Bow Curve
        const bowTension = isCurrentShooter && this.isAiming ? this.aimPower * 14 : 0;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(26, 0, 36, -Math.PI * 0.42, Math.PI * 0.42);
        ctx.stroke();

        // Bow String
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const bowTop = { x: 26 + Math.cos(-Math.PI * 0.42) * 36, y: Math.sin(-Math.PI * 0.42) * 36 };
        const bowBottom = { x: 26 + Math.cos(Math.PI * 0.42) * 36, y: Math.sin(Math.PI * 0.42) * 36 };
        const pullX = 26 - bowTension;
        ctx.moveTo(bowTop.x, bowTop.y);
        ctx.lineTo(pullX, 0);
        ctx.lineTo(bowBottom.x, bowBottom.y);
        ctx.stroke();

        // If aiming, draw nocked arrow ready to shoot
        if (isCurrentShooter && this.isAiming) {
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(pullX, 0);
            ctx.lineTo(pullX + ARROW_LENGTH, 0);
            ctx.stroke();

            // Arrow tip
            ctx.fillStyle = '#94a3b8';
            ctx.beginPath();
            ctx.moveTo(pullX + ARROW_LENGTH, -4);
            ctx.lineTo(pullX + ARROW_LENGTH + 8, 0);
            ctx.lineTo(pullX + ARROW_LENGTH, 4);
            ctx.closePath();
            ctx.fill();

            // Arrow fletching
            ctx.fillStyle = player.color;
            ctx.beginPath();
            ctx.moveTo(pullX, -5); ctx.lineTo(pullX + 8, 0); ctx.lineTo(pullX, 5);
            ctx.fill();
        }

        ctx.restore();
        ctx.restore();
    }

    drawTrajectoryPreview(ctx) {
        const p = this.players[this.activePlayer];
        const screenPos = this.worldToScreen(p.x + p.facing * 30, p.y - 45);

        const speed = this.aimPower * MAX_POWER_SPEED;
        const rad = (this.aimAngle * Math.PI) / 180;
        let simVx = Math.cos(rad) * speed * p.facing;
        let simVy = -Math.sin(rad) * speed;

        let simX = screenPos.x;
        let simY = screenPos.y;
        const simDt = 0.035;
        const steps = 18; // 初段導引輔助

        ctx.save();
        for (let i = 0; i < steps; i++) {
            simVx += this.wind.x * simDt;
            simVy += GRAVITY * simDt;
            simX += simVx * simDt;
            simY += simVy * simDt;

            const alpha = 1.0 - (i / steps);
            ctx.fillStyle = p.trailColor;
            ctx.beginPath();
            ctx.arc(simX, simY, 3.5 * alpha + 1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawArrow(ctx, arrow) {
        const pos = this.worldToScreen(arrow.x, arrow.y);

        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(arrow.angle);

        // Arrow Shaft
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-arrow.length + 8, 0);
        ctx.lineTo(0, 0);
        ctx.stroke();

        // Arrowhead (Metal Tip)
        ctx.fillStyle = '#f8fafc';
        ctx.beginPath();
        ctx.moveTo(0, -4);
        ctx.lineTo(8, 0);
        ctx.lineTo(0, 4);
        ctx.closePath();
        ctx.fill();

        // Arrow Fletching (Feathers with player color)
        const player = this.players[arrow.playerId];
        ctx.fillStyle = player ? player.color : '#ffd700';
        ctx.beginPath();
        ctx.moveTo(-arrow.length + 8, -5);
        ctx.lineTo(-arrow.length + 18, 0);
        ctx.lineTo(-arrow.length + 8, 5);
        ctx.closePath();
        ctx.fill();

        ctx.restore();

        // Draw luminous trail if flying
        if (arrow.isFlying && arrow.trail.length > 1) {
            ctx.save();
            for (let i = 0; i < arrow.trail.length - 1; i++) {
                const pt1 = this.worldToScreen(arrow.trail[i].x, arrow.trail[i].y);
                const pt2 = this.worldToScreen(arrow.trail[i + 1].x, arrow.trail[i + 1].y);
                const alpha = (i / arrow.trail.length) * 0.7;

                ctx.strokeStyle = player ? player.trailColor : '#ffd700';
                ctx.lineWidth = 3 * alpha + 1;
                ctx.beginPath();
                ctx.moveTo(pt1.x, pt1.y);
                ctx.lineTo(pt2.x, pt2.y);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    drawParticles(ctx) {
        this.particles.forEach(p => {
            const pos = p.isConfetti ? { x: p.x, y: p.y } : this.worldToScreen(p.x, p.y);
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;

            if (p.isConfetti) {
                ctx.translate(pos.x, pos.y);
                ctx.rotate((p.rotation * Math.PI) / 180);
                ctx.fillRect(-p.radius, -p.radius / 2, p.radius * 2, p.radius);
            } else {
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, p.radius, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        });
    }

    drawFloatingTexts(ctx) {
        this.floatingTexts.forEach(ft => {
            const pos = this.worldToScreen(ft.x, ft.y);
            ctx.save();
            ctx.globalAlpha = ft.alpha;
            ctx.font = `900 ${ft.fontSize}px 'Cinzel', 'Outfit', sans-serif`;
            ctx.fillStyle = ft.color;
            ctx.textAlign = 'center';
            ctx.shadowColor = ft.color;
            ctx.shadowBlur = 10;
            ctx.fillText(ft.text, pos.x, pos.y);
            ctx.restore();
        });
    }

    updateHUD() {
        // Player cards turn state
        const p1Card = document.getElementById('p1Card');
        const p2Card = document.getElementById('p2Card');

        if (p1Card && p2Card) {
            if (this.activePlayer === 1) {
                p1Card.classList.add('active-turn');
                p2Card.classList.remove('active-turn');
            } else {
                p2Card.classList.add('active-turn');
                p1Card.classList.remove('active-turn');
            }
        }

        // Scores / HP
        const p1 = this.players[1];
        const p2 = this.players[2];

        const p1ScoreEl = document.getElementById('p1Score');
        const p2ScoreEl = document.getElementById('p2Score');
        const p1HpFill = document.getElementById('p1HpFill');
        const p2HpFill = document.getElementById('p2HpFill');

        if (this.mode === 'duel') {
            if (p1ScoreEl) p1ScoreEl.textContent = `${p1.hp} HP`;
            if (p2ScoreEl) p2ScoreEl.textContent = `${p2.hp} HP`;
            if (p1HpFill) p1HpFill.style.width = `${p1.hp}%`;
            if (p2HpFill) p2HpFill.style.width = `${p2.hp}%`;
        } else {
            if (p1ScoreEl) p1ScoreEl.textContent = `${p1.score}`;
            if (p2ScoreEl) p2ScoreEl.textContent = `${p2.score}`;
        }

        // Streak badges
        const p1StreakEl = document.getElementById('p1Streak');
        const p2StreakEl = document.getElementById('p2Streak');
        if (p1StreakEl) {
            p1StreakEl.style.display = p1.streak >= 2 ? 'inline-block' : 'none';
            p1StreakEl.textContent = `連擊 ${p1.streak}X!`;
        }
        if (p2StreakEl) {
            p2StreakEl.style.display = p2.streak >= 2 ? 'inline-block' : 'none';
            p2StreakEl.textContent = `連擊 ${p2.streak}X!`;
        }

        // Arrow Dots
        this.updateArrowDots(1, p1.arrowsLeft);
        this.updateArrowDots(2, p2.arrowsLeft);

        // Angle & Power
        const hudAngle = document.getElementById('hudAngle');
        const hudPower = document.getElementById('hudPower');
        const hudPowerBar = document.getElementById('hudPowerBar');

        if (hudAngle) hudAngle.textContent = `${Math.abs(this.aimAngle).toFixed(1)}°`;
        if (hudPower) hudPower.textContent = `${Math.round(this.aimPower * 100)}%`;
        if (hudPowerBar) hudPowerBar.style.width = `${Math.round(this.aimPower * 100)}%`;

        // Round Indicator
        const roundInd = document.getElementById('roundIndicator');
        if (roundInd) {
            if (this.mode === 'target') {
                roundInd.textContent = `第 ${this.currentRound} 局 / 共 ${this.totalRounds} 局`;
            } else if (this.mode === 'duel') {
                roundInd.textContent = `決鬥場 • 生死淘汰制`;
            } else {
                roundInd.textContent = `練習場 • 無限箭矢`;
            }
        }
    }

    updateArrowDots(playerId, count) {
        const container = document.getElementById(`p${playerId}Arrows`);
        if (!container) return;
        const dots = container.querySelectorAll('.arrow-dot');
        dots.forEach((dot, idx) => {
            if (idx < count) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    }

    setupUIBindings() {
        // Mode cards selection
        const modeCards = document.querySelectorAll('.mode-card');
        modeCards.forEach(card => {
            card.addEventListener('click', () => {
                window.soundCtrl.playClick();
                modeCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.mode = card.dataset.mode;

                // Toggle visibility of target-specific settings
                const roundRow = document.getElementById('roundSettingRow');
                const targetMoveRow = document.getElementById('targetMoveSettingRow');
                if (roundRow) roundRow.style.display = this.mode === 'target' ? 'flex' : 'none';
                if (targetMoveRow) targetMoveRow.style.display = this.mode === 'target' ? 'flex' : 'none';
            });
        });

        // Pill button groups helper
        const setupPillGroup = (groupId, callback) => {
            const group = document.getElementById(groupId);
            if (!group) return;
            const buttons = group.querySelectorAll('.btn-pill');
            buttons.forEach(btn => {
                btn.addEventListener('click', () => {
                    window.soundCtrl.playClick();
                    buttons.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    callback(btn.dataset.val);
                });
            });
        };

        setupPillGroup('roundToggleGroup', (val) => { this.totalRounds = parseInt(val, 10); });
        setupPillGroup('windToggleGroup', (val) => { this.windDifficulty = val; });
        setupPillGroup('targetMoveGroup', (val) => { this.targetMotion = val; });
        setupPillGroup('trajectoryToggleGroup', (val) => { this.showTrajectory = (val === 'assist'); });

        // Start Game Button
        const btnStartGame = document.getElementById('btnStartGame');
        if (btnStartGame) {
            btnStartGame.addEventListener('click', () => {
                window.soundCtrl.playClick();
                document.getElementById('menuModal').classList.add('hidden');
                this.applySettings();
                this.resetMatch();
            });
        }

        // Quick Tools Buttons
        const btnSoundToggle = document.getElementById('btnSoundToggle');
        if (btnSoundToggle) {
            btnSoundToggle.addEventListener('click', () => {
                const muted = window.soundCtrl.toggleMute();
                btnSoundToggle.textContent = muted ? '🔇' : '🔊';
            });
        }

        const btnMenuToggle = document.getElementById('btnMenuToggle');
        if (btnMenuToggle) {
            btnMenuToggle.addEventListener('click', () => {
                window.soundCtrl.playClick();
                document.getElementById('menuModal').classList.remove('hidden');
            });
        }

        const btnRestartMatch = document.getElementById('btnRestartMatch');
        if (btnRestartMatch) {
            btnRestartMatch.addEventListener('click', () => {
                window.soundCtrl.playClick();
                this.resetMatch();
            });
        }

        const btnRulesGuide = document.getElementById('btnRulesGuide');
        const rulesModal = document.getElementById('rulesModal');
        const btnCloseRules = document.getElementById('btnCloseRules');
        const btnConfirmRules = document.getElementById('btnConfirmRules');

        if (btnRulesGuide) {
            btnRulesGuide.addEventListener('click', () => {
                window.soundCtrl.playClick();
                rulesModal.classList.remove('hidden');
            });
        }
        if (btnCloseRules) {
            btnCloseRules.addEventListener('click', () => {
                rulesModal.classList.add('hidden');
            });
        }
        if (btnConfirmRules) {
            btnConfirmRules.addEventListener('click', () => {
                window.soundCtrl.playClick();
                rulesModal.classList.add('hidden');
            });
        }

        // Fullscreen
        const btnFullscreen = document.getElementById('btnFullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                } else {
                    document.exitFullscreen().catch(() => {});
                }
            });
        }

        // Victory Modal Buttons
        const btnPlayAgain = document.getElementById('btnPlayAgain');
        if (btnPlayAgain) {
            btnPlayAgain.addEventListener('click', () => {
                window.soundCtrl.playClick();
                document.getElementById('victoryModal').classList.add('hidden');
                this.resetMatch();
            });
        }

        const btnBackToMenu = document.getElementById('btnBackToMenu');
        if (btnBackToMenu) {
            btnBackToMenu.addEventListener('click', () => {
                window.soundCtrl.playClick();
                document.getElementById('victoryModal').classList.add('hidden');
                document.getElementById('menuModal').classList.remove('hidden');
            });
        }
    }

    applySettings() {
        const p1HpWrapper = document.getElementById('p1HpWrapper');
        const p2HpWrapper = document.getElementById('p2HpWrapper');
        const targetCamWrapper = document.getElementById('targetCamWrapper');

        if (this.mode === 'duel') {
            if (p1HpWrapper) p1HpWrapper.style.display = 'block';
            if (p2HpWrapper) p2HpWrapper.style.display = 'block';
            if (targetCamWrapper) targetCamWrapper.style.display = 'none';
        } else {
            if (p1HpWrapper) p1HpWrapper.style.display = 'none';
            if (p2HpWrapper) p2HpWrapper.style.display = 'none';
            if (targetCamWrapper) targetCamWrapper.style.display = 'flex';
        }

        this.resize();
    }

    resetMatch() {
        this.isGameOver = false;
        this.isTurnTransitioning = false;
        this.currentRound = 1;
        this.activePlayer = 1;
        this.activeArrow = null;
        this.arrows = [];
        this.particles = [];
        this.floatingTexts = [];
        this.targetHitsHistory = [];

        // Reset players
        [1, 2].forEach(id => {
            const p = this.players[id];
            p.score = 0;
            p.hp = 100;
            p.streak = 0;
            p.bullseyes = 0;
            p.headshots = 0;
            p.arrowsLeft = this.arrowsPerRound;
            p.roundScores = [];
        });

        this.generateWind();
        this.drawTargetCam();
        this.updateHUD();

        const p = this.players[this.activePlayer];
        this.camera.targetX = p.x;
        this.camera.targetY = p.y - 80;
        this.camera.x = this.camera.targetX;
        this.camera.y = this.camera.targetY;

        this.showTurnBanner(`${p.name} 準備射擊！`);
    }

    loop(timestamp) {
        const dt = Math.min(0.08, (timestamp - this.lastTime) / 1000);
        this.lastTime = timestamp;

        this.updatePhysics(dt);
        this.draw();

        requestAnimationFrame((t) => this.loop(t));
    }
}

// Instantiate game on page load
window.addEventListener('DOMContentLoaded', () => {
    window.game = new ArcheryGame();
});
