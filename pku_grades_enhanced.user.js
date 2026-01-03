// ==UserScript==
// @name         PKU Grade Enhancement (v6.0)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  北大成绩单页面美化+统计分析+模拟计算 (经典配色版)
// @author       ttqqjj.smser
// @match        *://treehole.pku.edu.cn/*
// @match        *://pkuhelper.pku.edu.cn/*
// @grant        GM_addStyle
// @require      https://cdn.jsdelivr.net/npm/chart.js
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 1. 常量与配置
    // ==========================================
    const GRADE_MAP = {
        'P': null, 'NP': null, 'EX': null, 'IP': null, 'I': null, 'W': null,
        'A+': 4, 'A': 4, 'A-': 3.7, 'B+': 3.3, 'B': 3, 'B-': 2.7,
        'C+': 2.3, 'C': 2, 'C-': 1.7, 'D+': 1.3, 'D': 1, 'F': null
    };

    const SPECIAL_TEXT = {
        'P': '通过', 'NP': '未通过', 'EX': '免修',
        'IP': '跨学期', 'I': '缓考', 'W': '退课'
    };

    let useGPAMode = false;
    let isSimulating = false;
    let chartInstances = {};

    // ==========================================
    // 2. 核心计算函数
    // ==========================================
    function scoreToGPA(score) {
        if (score === null || score === undefined) return null;
        if (typeof score === 'string') {
            if (GRADE_MAP.hasOwnProperty(score)) return GRADE_MAP[score];
            let n = parseFloat(score);
            if (!isNaN(n)) score = n;
            else return null;
        }
        return score >= 60 ? 4 - 3 * Math.pow(100 - score, 2) / 1600 : null;
    }

    function gpaTo100(gpa) {
        if (gpa === null) return null;
        if (gpa >= 4) return 100;
        if (gpa >= 1) return (-40 * Math.sqrt(3) * Math.sqrt(4 - gpa) + 300) / 3;
        return null;
    }

    function calcRatio(score, useGPA) {
        let gpa = scoreToGPA(score);
        if (gpa === null) return 0;
        if (useGPA) return (gpa - 1) / 3;
        let s100 = gpaTo100(gpa);
        return (s100 - 60) / 40;
    }

    function isNull(score) {
        return scoreToGPA(score) === null;
    }

    function isFail(score) {
        return score === 'NP' || score === 'F' || (typeof score === 'number' && score < 60);
    }

    function getTitleColor(score, useGPA) {
        if (isNull(score)) return 'hsl(240,30%,88%)';
        return `hsl(${120 * calcRatio(score, useGPA)},${useGPA ? 97 : 100}%,70%)`;
    }

    function getGradient(score, useGPA) {
        if (isNull(score) || (typeof score === 'number' && score < 60)) {
            return { bg: 'hsl(240,30%,88%)', ratio: isFail(score) ? 0 : 1 };
        }
        let r = calcRatio(score, useGPA);
        let c1 = `hsl(${120*r},${useGPA?97:100}%,75%)`;
        let c2 = `hsl(${120*r},${useGPA?97:100}%,70%)`;
        let c3 = `hsl(${120*r},${useGPA?57:60}%,65%)`;
        let pct = Math.max(r, 0.01) * 100 + '%';
        return { bg: `linear-gradient(to right, ${c1}, ${c2} ${pct}, ${c3} ${pct})`, ratio: r };
    }

    function formatNumber(n, decimals) {
        if (typeof n !== 'number') return n;
        return n.toFixed(decimals).replace(/\.?0+$/, '');
    }

    function getGPADisplay(score) {
        let gpa = scoreToGPA(score);
        if (gpa !== null) return gpa.toFixed(2);
        if (typeof score === 'string' && SPECIAL_TEXT[score]) return SPECIAL_TEXT[score];
        return '-.--';
    }

    function getScoreDisplay(score) {
        if (typeof score === 'number') return formatNumber(score, 1);
        return score || '-.--';
    }

    function parseScore(text) {
        if (!text) return null;
        text = text.trim();
        if (GRADE_MAP.hasOwnProperty(text)) return text;
        if (SPECIAL_TEXT.hasOwnProperty(text)) {
            for (let k in SPECIAL_TEXT) {
                if (SPECIAL_TEXT[k] === text) return k;
            }
        }
        let n = parseFloat(text);
        return isNaN(n) ? text : n;
    }

    function calcWeightedGPA(courseData) {
        let totalCredit = 0, totalWeighted = 0;
        courseData.forEach(c => {
            let gpa = scoreToGPA(c.score);
            if (gpa !== null && c.credit > 0) {
                totalCredit += c.credit;
                totalWeighted += c.credit * gpa;
            }
        });
        return totalCredit > 0 ? totalWeighted / totalCredit : null;
    }

    // ==========================================
    // 3. DOM 操作与数据提取
    // ==========================================
    
    function getCreditFromRow(row) {
        let leftDiv = row.querySelector('.layout-row-left .layout-vertical-up');
        if (leftDiv) return parseFloat(leftDiv.textContent) || 0;
        return 0;
    }

    function getScoreFromRow(row) {
        let rightDiv = row.querySelector('.layout-row-right .layout-vertical-up');
        if (!rightDiv) return null;
        
        // 支持模拟模式的输入框
        let input = rightDiv.querySelector('input.sim-input');
        if (input) return parseScore(input.value);
        
        return parseScore(rightDiv.textContent);
    }

    function getDetailsFromRow(row) {
        let detailsDiv = row.querySelector('.layout-row-middle .layout-vertical-down');
        if (detailsDiv) return detailsDiv.textContent.trim();
        return '';
    }

    function parseTeacherInfo(rawTeacher) {
        if (!rawTeacher) return '（无教师信息）';
        let parts = rawTeacher.split(',');
        let first = parts[0];
        let match = /^[^-]+-([^$]+)\$([^$]*)\$([^$]*)$/.exec(first);
        if (match) {
            let name = match[1];
            let org = match[2];
            let suffix = parts.length > 1 ? `等${parts.length}人` : '';
            return `${name}（${org}）${suffix}`;
        }
        return first + (parts.length > 1 ? ` 等${parts.length}人` : '');
    }

    function getTeacherFromExtras(row) {
        let extraDiv = row.querySelector('.layout-vertical-extra');
        if (!extraDiv) return null;
        let ps = extraDiv.querySelectorAll('p');
        for (let p of ps) {
            let b = p.querySelector('b');
            if (b && b.textContent.includes('教师信息')) {
                let span = p.querySelector('span');
                if (span) return span.textContent.trim();
            }
        }
        return null;
    }

    function applyCourseColor(el, score) {
        if (score === null) return;
        if (typeof score === 'number' && score > 99.995) {
            el.classList.add('rainbow-moving');
            el.style.background = '';
        } else {
            el.classList.remove('rainbow-moving');
            let g = getGradient(score, useGPAMode);
            el.style.background = g.bg;
        }
    }

    function sortCourses(courseData) {
        return courseData.slice().sort((a, b) => {
            let gpaA = scoreToGPA(a.score);
            let gpaB = scoreToGPA(b.score);
            if (gpaA !== gpaB) {
                if (gpaB === null) return -1;
                if (gpaA === null) return 1;
                return gpaB - gpaA;
            }
            let failA = isFail(a.score) ? 1 : 0;
            let failB = isFail(b.score) ? 1 : 0;
            if (failA !== failB) return failA - failB;
            return b.origIndex - a.origIndex;
        });
    }

    // ==========================================
    // 4. 页面处理逻辑 (初始化结构)
    // ==========================================

    function processSemesterBlock(block) {
        if (block.dataset.gmProcessed) return;

        let titleRow = block.querySelector(':scope > div:first-child .layout-row');
        let courseRowEls = Array.from(block.querySelectorAll('.course-row'));
        if (!titleRow || courseRowEls.length === 0) return;

        // 1. 提取并排序课程
        let courseData = courseRowEls.map((el, index) => {
            let row = el.querySelector('.layout-row');
            return {
                el: el,
                row: row,
                credit: getCreditFromRow(row),
                score: getScoreFromRow(row),
                details: getDetailsFromRow(row),
                origIndex: index
            };
        });

        let sorted = sortCourses(courseData);
        let container = courseRowEls[0].parentElement;
        sorted.forEach(c => container.appendChild(c.el));

        // 2. 增强课程行显示
        sorted.forEach(c => {
            applyCourseColor(c.row, c.score);

            let rightDiv = c.row.querySelector('.layout-row-right .layout-vertical');
            if (rightDiv) {
                let upDiv = rightDiv.querySelector('.layout-vertical-up');
                let downDiv = rightDiv.querySelector('.layout-vertical-down');
                if (!downDiv) {
                    downDiv = document.createElement('div');
                    downDiv.className = 'layout-vertical-down';
                    // 复制样式属性
                    if (upDiv) {
                        Array.from(upDiv.attributes).forEach(attr => {
                            if (attr.name.startsWith('data-v-')) downDiv.setAttribute(attr.name, attr.value);
                        });
                    }
                    rightDiv.appendChild(downDiv);
                }
                // 初始值设置
                if (upDiv) upDiv.textContent = getScoreDisplay(c.score);
                downDiv.textContent = getGPADisplay(c.score);
            }

            // 补充课程详情
            let detailsDiv = c.row.querySelector('.layout-row-middle .layout-vertical-down');
            if (detailsDiv && !detailsDiv.dataset.gmSet) {
                let courseType = c.details;
                let rawTeacher = getTeacherFromExtras(c.row);
                let teacherStr = parseTeacherInfo(rawTeacher);
                detailsDiv.textContent = courseType + ' - ' + teacherStr;
                detailsDiv.dataset.gmSet = '1';
            }
        });

        // 3. 增强标题行显示
        let avgGPA = calcWeightedGPA(courseData);
        let avg100 = gpaTo100(avgGPA);
        titleRow.style.backgroundColor = getTitleColor(avg100, useGPAMode);
        
        let titleMiddle = titleRow.querySelector('.layout-row-middle');
        if (titleMiddle) titleMiddle.style.padding = '0';

        // 添加学分统计
        if (!titleRow.querySelector('.gm-credit-cell')) {
            let totalCredit = 0;
            courseData.forEach(c => {
                if (c.score !== 'W' && c.score !== 'I') totalCredit += c.credit;
            });
            let creditCell = document.createElement('div');
            creditCell.className = 'layout-row-left gm-credit-cell';
            creditCell.innerHTML = `
                <div class="layout-vertical">
                    <div class="layout-vertical-up">${totalCredit}</div>
                    <div class="layout-vertical-down">学分</div>
                </div>
            `;
            titleRow.insertBefore(creditCell, titleRow.firstChild);
        }

        // 添加课程数量
        let titleMiddleDiv = titleRow.querySelector('.layout-row-middle .layout-vertical');
        if (titleMiddleDiv) {
            let downDiv = titleMiddleDiv.querySelector('.layout-vertical-down');
            if (downDiv && !downDiv.dataset.gmSet) {
                downDiv.textContent = `共 ${courseData.length} 门课程`;
                downDiv.dataset.gmSet = '1';
            }
        }

        // 增强标题右侧 (GPA显示)
        let titleRightDiv = titleRow.querySelector('.layout-row-right .layout-vertical');
        if (titleRightDiv) {
            let upDiv = titleRightDiv.querySelector('.layout-vertical-up');
            let downDiv = titleRightDiv.querySelector('.layout-vertical-down');
            if (!upDiv) {
                upDiv = document.createElement('div');
                upDiv.className = 'layout-vertical-up';
                if (downDiv) {
                    Array.from(downDiv.attributes).forEach(attr => {
                        if (attr.name.startsWith('data-v-')) upDiv.setAttribute(attr.name, attr.value);
                    });
                }
                titleRightDiv.insertBefore(upDiv, titleRightDiv.firstChild);
            }
            if (!downDiv) {
                downDiv = document.createElement('div');
                downDiv.className = 'layout-vertical-down';
                if (upDiv) {
                    Array.from(upDiv.attributes).forEach(attr => {
                        if (attr.name.startsWith('data-v-')) downDiv.setAttribute(attr.name, attr.value);
                    });
                }
                titleRightDiv.appendChild(downDiv);
            }
            let displayGPA = upDiv.textContent.trim();
            if (displayGPA === '-.--' || !displayGPA) {
                displayGPA = avgGPA !== null ? avgGPA.toFixed(2) : '-.--';
            }
            upDiv.textContent = displayGPA;
            downDiv.textContent = avg100 !== null ? formatNumber(avg100, 1) : '-.--';
        }

        block.dataset.gmProcessed = '1';
    }

    function processOverallBlock(block) {
        if (block.dataset.gmProcessed) return;

        let titleRow = block.querySelector(':scope > div:first-child .layout-row');
        if (!titleRow) return;

        // 收集所有课程数据
        let allCourseData = [];
        document.querySelectorAll('.semester-block').forEach(sb => {
            if (sb === block) return;
            sb.querySelectorAll('.course-row').forEach(el => {
                let row = el.querySelector('.layout-row');
                allCourseData.push({
                    credit: getCreditFromRow(row),
                    score: getScoreFromRow(row)
                });
            });
        });

        let avgGPA = calcWeightedGPA(allCourseData);
        let avg100 = gpaTo100(avgGPA);
        titleRow.style.backgroundColor = getTitleColor(avg100, useGPAMode);
        
        let titleMiddle = titleRow.querySelector('.layout-row-middle');
        if (titleMiddle) titleMiddle.style.padding = '0';

        if (!titleRow.querySelector('.gm-credit-cell')) {
            let totalCredit = 0;
            allCourseData.forEach(c => {
                let gpa = scoreToGPA(c.score);
                if (gpa !== null || c.score === 'P' || c.score === 'EX') {
                    if (c.score !== 'W') totalCredit += c.credit;
                }
            });
            let creditCell = document.createElement('div');
            creditCell.className = 'layout-row-left gm-credit-cell';
            creditCell.innerHTML = `
                <div class="layout-vertical">
                    <div class="layout-vertical-up">${formatNumber(totalCredit, 1)}</div>
                    <div class="layout-vertical-down">学分</div>
                </div>
            `;
            titleRow.insertBefore(creditCell, titleRow.firstChild);
        }

        let titleRightDiv = titleRow.querySelector('.layout-row-right .layout-vertical');
        if (titleRightDiv) {
            let upDiv = titleRightDiv.querySelector('.layout-vertical-up');
            let downDiv = titleRightDiv.querySelector('.layout-vertical-down');
            if (!downDiv) {
                downDiv = document.createElement('div');
                downDiv.className = 'layout-vertical-down';
                if (upDiv) {
                    Array.from(upDiv.attributes).forEach(attr => {
                        if (attr.name.startsWith('data-v-')) downDiv.setAttribute(attr.name, attr.value);
                    });
                }
                titleRightDiv.appendChild(downDiv);
            }
            downDiv.textContent = avg100 !== null ? formatNumber(avg100, 1) : '-.--';
        }

        block.dataset.gmProcessed = '1';
    }

    function processPage() {
        let semesterBlocks = Array.from(document.querySelectorAll('.semester-block'));
        if (semesterBlocks.length === 0) return;

        let lastBlock = semesterBlocks[semesterBlocks.length - 1];
        let lastTitleUp = lastBlock.querySelector('.layout-row-middle .layout-vertical-up');
        let isLastOverall = lastTitleUp && lastTitleUp.textContent.includes('总');

        semesterBlocks.forEach((block, i) => {
            if (isLastOverall && i === semesterBlocks.length - 1) {
                processOverallBlock(block);
            } else {
                processSemesterBlock(block);
            }
        });
        
        // 页面处理完后，初始化图表（如果还没初始化）
        if (!document.getElementById('gm-charts-container')) {
            initCharts();
        }
        updateCharts();
    }

    // ==========================================
    // 5. 动态更新逻辑 (用于模拟和切换颜色)
    // ==========================================

    function recalculateAll() {
        let semesterBlocks = Array.from(document.querySelectorAll('.semester-block'));
        let allCourseData = [];

        semesterBlocks.forEach(block => {
            let titleRow = block.querySelector(':scope > div:first-child .layout-row');
            let isOverall = titleRow && titleRow.textContent.includes('总');
            
            if (isOverall) return; // 总成绩块稍后处理

            let courseData = [];
            block.querySelectorAll('.course-row .layout-row').forEach(row => {
                let score = getScoreFromRow(row);
                let credit = getCreditFromRow(row);
                
                // 更新行颜色
                applyCourseColor(row, score);
                
                // 更新行 GPA 显示
                let rightDiv = row.querySelector('.layout-row-right .layout-vertical');
                if (rightDiv) {
                    let downDiv = rightDiv.querySelector('.layout-vertical-down');
                    if (downDiv) downDiv.textContent = getGPADisplay(score);
                }

                courseData.push({ credit: credit, score: score });
                allCourseData.push({ credit: credit, score: score });
            });

            // 更新学期标题统计
            let avgGPA = calcWeightedGPA(courseData);
            let avg100 = gpaTo100(avgGPA);
            if (titleRow) {
                titleRow.style.backgroundColor = getTitleColor(avg100, useGPAMode);
                let rightUp = titleRow.querySelector('.layout-row-right .layout-vertical-up');
                let rightDown = titleRow.querySelector('.layout-row-right .layout-vertical-down');
                if (rightUp) rightUp.textContent = avgGPA !== null ? avgGPA.toFixed(2) : '-.--';
                if (rightDown) rightDown.textContent = avg100 !== null ? formatNumber(avg100, 1) : '-.--';
            }
        });

        // 更新总成绩块
        let overallBlock = semesterBlocks.find(b => b.querySelector(':scope > div:first-child .layout-row').textContent.includes('总'));
        if (overallBlock) {
            let titleRow = overallBlock.querySelector(':scope > div:first-child .layout-row');
            let avgGPA = calcWeightedGPA(allCourseData);
            let avg100 = gpaTo100(avgGPA);
            if (titleRow) {
                titleRow.style.backgroundColor = getTitleColor(avg100, useGPAMode);
                let rightDown = titleRow.querySelector('.layout-row-right .layout-vertical-down');
                if (rightDown) rightDown.textContent = avg100 !== null ? formatNumber(avg100, 1) : '-.--';
            }
        }

        updateCharts();
    }

    // ==========================================
    // 6. 新功能：模拟模式
    // ==========================================

    function toggleSimulation() {
        isSimulating = !isSimulating;
        let btn = document.getElementById('gm-sim-toggle');
        if (btn) {
            btn.innerHTML = isSimulating ? '<span class="icon icon-check"></span> 完成模拟' : '<span class="icon icon-edit"></span> 开启模拟';
            if (isSimulating) btn.classList.add('active');
            else btn.classList.remove('active');
        }

        document.querySelectorAll('.course-row .layout-row-right .layout-vertical-up').forEach(el => {
            if (isSimulating) {
                let currentScore = parseScore(el.textContent);
                if (typeof currentScore === 'number') {
                    el.dataset.origScore = el.textContent;
                    el.innerHTML = `<input type="number" class="sim-input" value="${currentScore}" step="1" min="0" max="100">`;
                    let input = el.querySelector('input');
                    input.addEventListener('input', recalculateAll);
                    input.addEventListener('click', e => e.stopPropagation());
                }
            } else {
                if (el.dataset.origScore) {
                    el.textContent = el.dataset.origScore;
                } else {
                    // 尝试恢复 input 的值
                    let input = el.querySelector('input');
                    if (input) el.textContent = input.value;
                }
            }
        });
        recalculateAll();
    }

    // ==========================================
    // 7. 新功能：图表统计
    // ==========================================

    function initCharts() {
        if (document.getElementById('gm-charts-container')) return;

        let container = document.createElement('div');
        container.id = 'gm-charts-container';
        container.innerHTML = `
            <div class="chart-card"><canvas id="gm-trend-chart"></canvas></div>
            <div class="chart-card"><canvas id="gm-cumulative-chart"></canvas></div>
            <div class="chart-card"><canvas id="gm-credits-chart"></canvas></div>
            <div class="chart-card"><canvas id="gm-dist-chart"></canvas></div>
        `;
        
        // 插入到页面底部
        let viewer = document.querySelector('.viewer');
        if (viewer) viewer.appendChild(container);
        else document.body.appendChild(container);

        // 初始化图表实例
        const ctxTrend = document.getElementById('gm-trend-chart').getContext('2d');
        const ctxCum = document.getElementById('gm-cumulative-chart').getContext('2d');
        const ctxCredits = document.getElementById('gm-credits-chart').getContext('2d');
        const ctxDist = document.getElementById('gm-dist-chart').getContext('2d');

        chartInstances.trend = new Chart(ctxTrend, {
            type: 'line',
            data: { labels: [], datasets: [{
                label: '学期GPA',
                data: [],
                borderColor: '#8B0012',
                backgroundColor: 'rgba(139, 0, 18, 0.1)',
                tension: 0.3,
                fill: true
            }]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: true, text: '学期GPA走势' } }
            }
        });

        chartInstances.cumulative = new Chart(ctxCum, {
            type: 'line',
            data: { labels: [], datasets: [{
                label: '累计GPA',
                data: [],
                borderColor: '#2980b9',
                backgroundColor: 'rgba(41, 128, 185, 0.1)',
                tension: 0.3,
                fill: true
            }]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: true, text: '累计GPA走势' } }
            }
        });

        chartInstances.credits = new Chart(ctxCredits, {
            type: 'bar',
            data: { labels: [], datasets: [{
                label: '学期学分',
                data: [],
                backgroundColor: '#27ae60'
            }]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: true, text: '学期修读学分' } }
            }
        });

        chartInstances.dist = new Chart(ctxDist, {
            type: 'bar',
            data: { labels: ['<60', '60-70', '70-80', '80-90', '90-100'], datasets: [{
                label: '课程数量',
                data: [],
                backgroundColor: ['#e74c3c', '#e67e22', '#f1c40f', '#3498db', '#2ecc71']
            }]},
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { title: { display: true, text: '分数段分布' } }
            }
        });
    }

    function updateCharts() {
        if (!chartInstances.trend) return;

        // 页面通常是倒序排列（新学期在前），图表需要正序（旧学期在前），因此反转数组
        let semesterBlocks = Array.from(document.querySelectorAll('.semester-block')).reverse();
        let labels = [];
        let dataGPA = [];
        let dataCumGPA = [];
        let dataCredits = [];
        let distData = [0, 0, 0, 0, 0];

        let totalWeighted = 0;
        let totalCredits = 0;

        semesterBlocks.forEach(block => {
            let titleRow = block.querySelector(':scope > div:first-child .layout-row');
            if (!titleRow || titleRow.textContent.includes('总')) return;

            // 获取学期名
            let titleEl = titleRow.querySelector('.layout-row-middle .layout-vertical-up');
            let semName = titleEl ? titleEl.textContent.trim() : '未知学期';

            // 计算该学期数据
            let courseData = [];
            let semWeighted = 0;
            let semCredits = 0;

            block.querySelectorAll('.course-row .layout-row').forEach(row => {
                let score = getScoreFromRow(row);
                let credit = getCreditFromRow(row);
                courseData.push({ credit, score });

                // 分布统计
                if (typeof score === 'number') {
                    if (score < 60) distData[0]++;
                    else if (score < 70) distData[1]++;
                    else if (score < 80) distData[2]++;
                    else if (score < 90) distData[3]++;
                    else distData[4]++;
                }

                let gpa = scoreToGPA(score);
                if (gpa !== null && credit > 0) {
                    semWeighted += gpa * credit;
                    semCredits += credit;
                }
            });

            let avgGPA = calcWeightedGPA(courseData);
            if (semCredits > 0) {
                labels.push(semName);
                dataGPA.push(avgGPA !== null ? avgGPA.toFixed(2) : 0);
                dataCredits.push(semCredits);

                totalWeighted += semWeighted;
                totalCredits += semCredits;
                dataCumGPA.push((totalWeighted / totalCredits).toFixed(2));
            }
        });

        chartInstances.trend.data.labels = labels;
        chartInstances.trend.data.datasets[0].data = dataGPA;
        chartInstances.trend.update();

        chartInstances.cumulative.data.labels = labels;
        chartInstances.cumulative.data.datasets[0].data = dataCumGPA;
        chartInstances.cumulative.update();

        chartInstances.credits.data.labels = labels;
        chartInstances.credits.data.datasets[0].data = dataCredits;
        chartInstances.credits.update();

        chartInstances.dist.data.datasets[0].data = distData;
        chartInstances.dist.update();
    }

    // ==========================================
    // 8. UI 初始化与样式
    // ==========================================

    GM_addStyle(`
        .container { color: #fff !important; }
        .controller-bar { color: #add8e6 !important; }
        .controller-bar a { color: #add8e6 !important; cursor: pointer; margin-right: 15px; }
        .osu-text { color: #fff !important; }
        .footer { color: #add8e6 !important; text-align: center !important; }
        .footer p { color: #add8e6 !important; }
        .controller-bar-tip { color: #add8e6 !important; text-align: center !important; }

        .semester-block > :first-child {
            box-shadow: 0 0 6px rgba(0,0,0,.8) !important;
            border: none !important;
        }
        .semester-block > :first-child .layout-row {
            padding-top: 0.25em !important;
            padding-bottom: 0.25em !important;
        }
        .course-row {
            box-shadow: 0 -1px 0 #7f7f7f !important;
            border: none !important;
        }

        .rainbow-moving {
            background: linear-gradient(-45deg,#c5fcc5,#ffd1d1,#d1d1ff,#c5fcc5,#ffd1d1,#d1d1ff,#c5fcc5,#ffd1d1,#d1d1ff,#c5fcc5,#ffd1d1,#d1d1ff,#c5fcc5) 0 0 !important;
            background-size: 1800px 200px !important;
            animation: rainbow-moving 5s linear infinite !important;
        }
        @keyframes rainbow-moving {
            0% { background-position-x: 0; }
            100% { background-position-x: -1000px; }
        }

        .gm-credit-cell {
            flex: 0 0 2.5em; text-align: center;
        }
        .gm-credit-cell .layout-vertical-up { font-size: 1em; }
        .gm-credit-cell .layout-vertical-down { font-size: 60%; }

        /* 按钮样式优化 */
        .gm-btn {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 15px;
            text-decoration: none !important;
            transition: all 0.2s;
            border: 1px solid rgba(255,255,255,0.3);
            margin-right: 10px;
            cursor: pointer;
        }
        .gm-btn:hover {
            background: rgba(255,255,255,0.1);
            transform: translateY(-1px);
        }

        /* 模拟按钮高亮样式 */
        #gm-sim-toggle {
            background: linear-gradient(135deg, #ff6b6b, #ee5253);
            color: white !important;
            border: none;
            box-shadow: 0 4px 15px rgba(238, 82, 83, 0.4);
            font-weight: bold;
            padding: 6px 18px;
            margin-left: 10px;
        }
        #gm-sim-toggle:hover {
            transform: scale(1.05) translateY(-2px);
            box-shadow: 0 6px 20px rgba(238, 82, 83, 0.6);
        }
        #gm-sim-toggle.active {
            background: linear-gradient(135deg, #1dd1a1, #10ac84);
            box-shadow: 0 4px 15px rgba(16, 172, 132, 0.4);
        }

        /* 新增样式 */
        input.sim-input {
            background: rgba(255,255,255,0.9);
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 2px;
            width: 50px;
            text-align: center;
            color: #333;
            font-weight: bold;
        }
        #gm-charts-container {
            max-width: 1000px;
            margin: 30px auto;
            display: none; /* 默认隐藏 */
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            padding-bottom: 50px;
            animation: fadeIn 0.5s ease;
        }
        #gm-charts-container.visible {
            display: grid;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .chart-card {
            background: rgba(255,255,255,0.95);
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            height: 300px;
        }
    `);

    function addControls() {
        let controllerBar = document.querySelector('.controller-bar');
        if (!controllerBar || document.getElementById('gm-color-toggle')) return;

        // 颜色切换按钮
        let toggleColor = document.createElement('a');
        toggleColor.id = 'gm-color-toggle';
        toggleColor.className = 'gm-btn';
        toggleColor.innerHTML = '<span class="icon icon-display"></span> 四分制着色';
        toggleColor.title = '切换着色模式';
        toggleColor.onclick = function() {
            useGPAMode = !useGPAMode;
            toggleColor.innerHTML = useGPAMode ? '<span class="icon icon-display"></span> 百分制着色' : '<span class="icon icon-display"></span> 四分制着色';
            recalculateAll();
        };
        controllerBar.appendChild(toggleColor);

        // 图表开关按钮
        let toggleChart = document.createElement('a');
        toggleChart.id = 'gm-chart-toggle';
        toggleChart.className = 'gm-btn';
        toggleChart.innerHTML = '<span class="icon icon-bar-chart"></span> 显示图表';
        toggleChart.onclick = function() {
            let container = document.getElementById('gm-charts-container');
            if (container) {
                container.classList.toggle('visible');
                let isVisible = container.classList.contains('visible');
                toggleChart.innerHTML = isVisible ? '<span class="icon icon-bar-chart"></span> 隐藏图表' : '<span class="icon icon-bar-chart"></span> 显示图表';
                if (isVisible) updateCharts();
            }
        };
        controllerBar.appendChild(toggleChart);

        // 模拟模式按钮
        let toggleSim = document.createElement('a');
        toggleSim.id = 'gm-sim-toggle';
        toggleSim.className = 'gm-btn';
        toggleSim.innerHTML = '<span class="icon icon-edit"></span> 开启模拟';
        toggleSim.title = '开启后可修改成绩进行模拟计算';
        toggleSim.onclick = toggleSimulation;
        controllerBar.appendChild(toggleSim);
    }

    function restoreFooter() {
        let existingFooter = document.querySelector('.footer');
        if (!existingFooter || existingFooter.classList.contains('gm-restored')) return;

        existingFooter.innerHTML = `
            <p>绩点公式 <a>GPA(x) = 4-3*(100-x)<sup>2</sup>/1600</a></p>
            <br>
            <p>学期GPA和总GPA为公式计算所得，请以学校官方结果为准！</p>
        `;
        existingFooter.classList.add('gm-restored');
    }

    function init() {
        let viewer = document.querySelector('.viewer');
        if (viewer) {
            processPage();
            addControls();
            restoreFooter();
        }
    }

    // 优化后的观察者逻辑
    let observer = new MutationObserver(function(mutations) {
        let shouldInit = mutations.some(m => 
            m.addedNodes.length > 0 && 
            (document.querySelector('.viewer') || document.querySelector('.semester-block'))
        );
        if (shouldInit) setTimeout(init, 100);
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    // 兜底检测
    setInterval(function() {
        if (document.querySelector('.viewer') && !document.getElementById('gm-color-toggle')) init();
    }, 1000);

    function forceBackground() {
        let main = document.querySelector('.main');
        if (main) main.style.setProperty('background-color', '#333', 'important');
    }

    if (document.body) forceBackground();
    document.addEventListener('DOMContentLoaded', forceBackground);
    window.addEventListener('load', forceBackground);
    setInterval(forceBackground, 500);

})();
