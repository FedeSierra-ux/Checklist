package com.pendientes.app;

import android.content.Context;
import android.content.Intent;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/** Provee las filas del widget desde los datos guardados por la app. */
public class WidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new PendientesFactory(getApplicationContext());
    }

    static class PendientesFactory implements RemoteViewsService.RemoteViewsFactory {
        private static final int INK = 0xFF20242B;
        private static final int MUTED = 0xFF8A8578;
        private static final int ACCENT = 0xFFA8683F;
        private static final int DUE = 0xFFC9463A;

        private final Context context;
        private JSONArray tasks = new JSONArray();
        private Set<String> done = new HashSet<>();
        private String today = "";

        PendientesFactory(Context context) {
            this.context = context;
        }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            tasks = PendientesWidget.visibleTasks(context);
            done = PendientesWidget.toggled(context);
            today = PendientesWidget.today();
        }
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
            if (o == null) return row;
            String id = o.optString("id");
            String title = o.optString("title");
            String date = o.optString("date", "");
            boolean isDone = done.contains(id);
            boolean overdue = !date.isEmpty() && date.compareTo(today) < 0;

            if (isDone) {
                SpannableString s = new SpannableString(title);
                s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                row.setTextViewText(R.id.row_title, s);
            } else {
                row.setTextViewText(R.id.row_title, title);
            }
            row.setTextColor(R.id.row_title, isDone ? MUTED : INK);
            row.setTextViewText(R.id.row_time, overdue ? "Vencida" : o.optString("time"));
            row.setTextColor(R.id.row_time, overdue && !isDone ? DUE : ACCENT);
            row.setImageViewResource(R.id.row_check, isDone ? R.drawable.widget_check_done : R.drawable.widget_check);

            // Círculo: tildar / destildar. Texto: abrir la tarea en la app.
            Intent toggle = new Intent(PendientesWidget.ACTION_TOGGLE);
            toggle.putExtra(PendientesWidget.EXTRA_ID, id);
            row.setOnClickFillInIntent(R.id.row_check_area, toggle);
            Intent open = new Intent(PendientesWidget.ACTION_OPEN);
            open.putExtra(PendientesWidget.EXTRA_ID, id);
            row.setOnClickFillInIntent(R.id.row_text_area, open);
            return row;
        }
    }
}
