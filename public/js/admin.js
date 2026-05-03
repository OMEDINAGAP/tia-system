const token = localStorage.getItem("token");

function updateTime() {
    document.getElementById("time").innerText =
        new Date().toLocaleTimeString();
}
setInterval(updateTime, 1000);

let chart;

async function loadDashboard() {

    const res = await fetch("/admin-data", {
        headers: { Authorization: "Bearer " + token }
    });

    const data = await res.json();

    let done = 0, progress = 0, fail = 0;

    const table = document.getElementById("table");
    table.innerHTML = "";

    data.users.forEach(u => {

        let badge = "warn";

        if (u.progress >= 100) { done++; badge = "ok"; }
        else if (u.progress < 10) { fail++; badge = "bad"; }
        else progress++;

        table.innerHTML += `
      <tr>
        <td>${u.name}</td>
        <td>${u.progress.toFixed(1)}%</td>
        <td><span class="badge ${badge}">
          ${badge === "ok" ? "Completado" : badge === "warn" ? "En curso" : "Bajo"}
        </span></td>
      </tr>
    `;
    });

    document.getElementById("users").innerText = data.users.length;
    document.getElementById("done").innerText = done;
    document.getElementById("progress").innerText = progress;
    document.getElementById("fail").innerText = fail;

    const avg = data.users.reduce((a, b) => a + b.progress, 0) / data.users.length || 0;
    document.getElementById("bar-fill").style.width = avg + "%";
    document.getElementById("bar-text").innerText = avg.toFixed(1) + "%";

    // ALERTAS
    const alerts = document.getElementById("alerts");
    alerts.innerHTML = "";
    data.users.forEach(u => {
        if (u.progress < 10) {
            alerts.innerHTML += `<li>⚠ ${u.name} no avanza</li>`;
        }
    });

    // ACTIVIDAD
    const activity = document.getElementById("activity");
    activity.innerHTML = "";
    data.activity.forEach(a => {
        activity.innerHTML += `<li>${a}</li>`;
    });

    // CHART
    const ctx = document.getElementById("chart");

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Completado', 'En curso', 'Bajo'],
            datasets: [{
                data: [done, progress, fail],
                backgroundColor: ['#22c55e', '#eab308', '#ef4444']
            }]
        }
    });
}


function copyCode() {
    const code = document.getElementById("dailyCode").innerText;
    navigator.clipboard.writeText(code);
    alert("Código copiado");
}

async function loadDailyCode() {

    const res = await fetch("/daily-code", {
        headers: {
            Authorization: "Bearer " + token
        }
    });

    const data = await res.json();

    document.getElementById("dailyCode").innerText = data.code;
}


loadDashboard();
loadDailyCode();
setInterval(loadDashboard, 5000);

