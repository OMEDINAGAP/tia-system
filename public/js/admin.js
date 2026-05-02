const token = localStorage.getItem("token");

function updateTime() {
  document.getElementById("time").innerText =
    new Date().toLocaleTimeString();
}
setInterval(updateTime, 1000);

async function loadDashboard() {

  const res = await fetch("/admin-data", {
    headers: { Authorization: "Bearer " + token }
  });

  const data = await res.json();

  // KPIs
  document.getElementById("users").innerText = data.users.length;

  let completed = 0, progress = 0;

  const table = document.getElementById("table");
  table.innerHTML = "";

  data.users.forEach(u => {

    if (u.progress >= 100) completed++;
    else if (u.progress > 0) progress++;

    const row = `
      <tr>
        <td>${u.name}</td>
        <td>${u.folio}</td>
        <td>${u.progress}%</td>
        <td>${u.video}</td>
        <td>${u.minute}s</td>
        <td>${u.progress >= 100 ? "✔" : "⏳"}</td>
      </tr>
    `;

    table.innerHTML += row;
  });

  document.getElementById("done").innerText = completed;
  document.getElementById("progress").innerText = progress;

  // PROGRESO GLOBAL
  const avg = data.users.reduce((a,b)=>a+b.progress,0)/data.users.length || 0;

  document.getElementById("bar-fill").style.width = avg + "%";
  document.getElementById("bar-text").innerText = avg.toFixed(1)+"%";

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
}

loadDashboard();
setInterval(loadDashboard, 5000);