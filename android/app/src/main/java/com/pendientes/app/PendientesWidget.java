package com.pendientes.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Widget de pantalla de inicio con los pendientes de hoy.
 * Lee los datos que la app web guarda vía Capacitor Preferences
 * (SharedPreferences "CapacitorStorage", clave "widget_tasks").
 * Tocar una tarea la marca como hecha; tocar el encabezado abre la app.
 */
public class PendientesWidget extends AppWidgetProvider {

    public static final String ACTION_TOGGLE = "com.pendientes.app.TOGGLE";
    public static final String ACTION_REFRESH = "com.pendientes.app.REFRESH";
    public static final String EXTRA_ID = "task_id";
    public static final String PREFS = "CapacitorStorage";

    public static void updateAll(Context context) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(context);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(context, PendientesWidget.class));
        for (int id : ids) updateWidget(context, mgr, id);
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    static void updateWidget(Context context, AppWidgetManager mgr, int widgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_pendientes);

        // Servicio que provee las filas (intent único por widget)
        Intent svc = new Intent(context, WidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, svc);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);

        int count = readTasks(context).length();
        views.setViewVisibility(R.id.widget_empty, count == 0 ? View.VISIBLE : View.GONE);

        // Abrir la app al tocar el título o el +
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) launch = new Intent(context, MainActivity.class);
        PendingIntent open = PendingIntent.getActivity(
                context, 0, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_title, open);
        views.setOnClickPendingIntent(R.id.widget_add, open);

        // Template para el click de cada fila (se completa con fillInIntent)
        Intent toggle = new Intent(context, PendientesWidget.class);
        toggle.setAction(ACTION_TOGGLE);
        PendingIntent togglePI = PendingIntent.getBroadcast(
                context, 1, toggle,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
        views.setPendingIntentTemplate(R.id.widget_list, togglePI);

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

    @Override
    public void onUpdate(Context context, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) updateWidget(context, mgr, id);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        if (ACTION_TOGGLE.equals(action)) {
            String id = intent.getStringExtra(EXTRA_ID);
            if (id != null) {
                markDone(context, id);
                updateAll(context);
            }
        } else if (ACTION_REFRESH.equals(action)) {
            updateAll(context);
        }
    }

    private void markDone(Context context, String id) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        // Avisar a la app para que marque la tarea como hecha al abrir
        prefs.edit().putString("widget_toggle", id).apply();
        // Sacarla de la lista del widget para feedback inmediato
        JSONArray arr = readTasks(context);
        JSONArray out = new JSONArray();
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.optJSONObject(i);
            if (o == null) continue;
            if (!id.equals(o.optString("id"))) out.put(o);
        }
        prefs.edit().putString("widget_tasks", out.toString()).apply();
    }
}
