package com.pendientes.app;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/** Provee las filas del widget desde los datos guardados por la app. */
public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new PendientesFactory(getApplicationContext());
    }

    static class PendientesFactory implements RemoteViewsService.RemoteViewsFactory {
        private final Context context;
        private JSONArray tasks = new JSONArray();

        PendientesFactory(Context context) {
            this.context = context;
        }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() { tasks = PendientesWidget.readTasks(context); }
        @Override public void onDestroy() {}
        @Override public int getCount() { return tasks.length(); }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
        @Override public RemoteViews getLoadingView() { return null; }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_row);
            JSONObject o = tasks.optJSONObject(position);
            if (o != null) {
                row.setTextViewText(R.id.row_title, o.optString("title"));
                row.setTextViewText(R.id.row_time, o.optString("time"));
                Intent fill = new Intent();
                fill.putExtra(PendientesWidget.EXTRA_ID, o.optString("id"));
                row.setOnClickFillInIntent(R.id.row_root, fill);
            }
            return row;
        }
    }
}
