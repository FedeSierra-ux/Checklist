package com.pendientes.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Widget de pantalla de inicio con los pendientes de hoy (y lo vencido).
 *
 * La app guarda vía Capacitor Preferences (SharedPreferences "CapacitorStorage",
 * clave "widget_tasks") los pendientes de la próxima semana CON su fecha, y el
 * widget filtra "hoy" él mismo: así, pasada la medianoche, muestra lo del día
 * nuevo aunque la app no se haya abierto. Una alarma a las 00:00 lo refresca.
 *
 * Tocar el círculo tilda la tarea (queda tachada; tocar otra vez la destilda,
 * para que un toque sin querer no la complete). La app aplica lo tildado al
 * abrirse. Tocar el texto abre la app en esa tarea.
 */
public class PendientesWidget extends AppWidgetProvider {

    public static final String ACTION_TOGGLE = "com.pendientes.app.TOGGLE";
    public static final String ACTION_OPEN = "com.pendientes.app.OPEN";
    public static final String ACTION_REFRESH = "com.pendientes.app.REFRESH";
    public static final String EXTRA_ID = "task_id";
    public static final String PREFS = "CapacitorStorage";

    public static void updateAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, PendientesWidget.class));
        for (int id : ids) updateWidget(context, mgr, id);
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        if (ids.length > 0) scheduleMidnight(context);
    }

    static String today() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    static void updateWidget(Context context, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_pendientes);

        // Servicio que provee las filas (intent único por widget)
        Intent svc = new Intent(context, WidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svc);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        JSONArray tasks = visibleTasks(context);
        Set<String> done = toggled(context);
        int pending = 0;
        for (int i = 0; i < tasks.length(); i++) {
            JSONObject o = tasks.optJSONObject(i);
            if (o != null && !done.contains(o.optString("id"))) pending++;
        }
        views.setTextViewText(R.id.widget_title, pending > 0 ? "Hoy · " + pending : "Hoy");
        views.setViewVisibility(R.id.widget_empty, tasks.length() == 0 ? View.VISIBLE : View.GONE);

        // Abrir la app al tocar el título o el +
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        PendingIntent open = PendingIntent.getActivity(
                context, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_title, open);
        views.setOnClickPendingIntent(R.id.widget_add, open);

        // Template sin acción: cada fila completa TOGGLE (círculo) u OPEN (texto)
        // con su fillInIntent.
        Intent template = new Intent(context, PendientesWidget.class);
        PendingIntent templatePI = PendingIntent.getBroadcast(
                context, 1, template,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        views.setPendingIntentTemplate(R.id.widget_list, templatePI);

        mgr.updateAppWidget(widgetId, views);
    }

    public static JSONArray readTasks(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString("widget_tasks", "[]");
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    /** Lo que se ve: lo de hoy y lo vencido (fecha <= hoy). */
    public static JSONArray visibleTasks(Context context) {
        JSONArray all = readTasks(context);
        String today = today();
        JSONArray out = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject o = all.optJSONObject(i);
            if (o == null) continue;
            String date = o.optString("date", "");
            // Datos de una versión vieja de la app (sin fecha): eran los de hoy.
            if (date.isEmpty() || date.compareTo(today) <= 0) out.put(o);
        }
        return out;
    }

    /** Ids tildados en el widget que la app todavía no aplicó. */
    public static Set<String> toggled(Context context) {
        Set<String> out = new HashSet<>();
        String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("widget_toggle", null);
        if (raw == null) return out;
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) out.add(arr.optString(i));
        } catch (Exception e) {
            out.add(raw);           // formato viejo: un id suelto
        }
        return out;
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(context, mgr, id);
        // Sin esto la RemoteViewsFactory se reutiliza y no vuelve a leer los
        // datos, así que el widget quedaría mostrando la lista vieja.
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
        scheduleMidnight(context);
    }

    @Override
    public void onDisabled(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(midnightIntent(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_TOGGLE.equals(action)) {
            String id = intent.getStringExtra(EXTRA_ID);
            if (id != null) {
                toggle(context, id);
                updateAll(context);
            }
        } else if (ACTION_OPEN.equals(action)) {
            String id = intent.getStringExtra(EXTRA_ID);
            if (id != null) openTask(context, id);
        } else if (ACTION_REFRESH.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)
                || Intent.ACTION_DATE_CHANGED.equals(action)) {
            updateAll(context);
        }
    }

    // Tilda o destilda: un segundo toque deshace el primero.
    private void toggle(Context context, String id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Set<String> done = toggled(context);
        if (!done.remove(id)) done.add(id);
        JSONArray out = new JSONArray();
        for (String s : done) out.put(s);
        SharedPreferences.Editor ed = prefs.edit();
        if (out.length() == 0) ed.remove("widget_toggle");
        else ed.putString("widget_toggle", out.toString());
        ed.apply();
    }

    // La app lee "widget_open" al abrirse y muestra esa tarea.
    private void openTask(Context context, String id) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString("widget_open", id).apply();
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(launch);
        } catch (Exception e) {
            // Si el sistema no deja abrirla desde acá, queda pendiente para la
            // próxima vez que se abra la app.
        }
    }

    private static PendingIntent midnightIntent(Context context) {
        Intent i = new Intent(context, PendientesWidget.class);
        i.setAction(ACTION_REFRESH);
        return PendingIntent.getBroadcast(context, 2, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // Refresco a las 00:00 (no exacto: alcanza con que pase al despertar).
    static void scheduleMidnight(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Calendar c = Calendar.getInstance();
        c.add(Calendar.DAY_OF_YEAR, 1);
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 30);
        c.set(Calendar.MILLISECOND, 0);
        PendingIntent pi = midnightIntent(context);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC, c.getTimeInMillis(), pi);
        } else {
            am.set(AlarmManager.RTC, c.getTimeInMillis(), pi);
        }
    }
}
