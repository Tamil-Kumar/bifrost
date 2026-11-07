// A stand-in for libnotify, the library Electron shows notifications with on Linux, for the automated tests
// (tests/e2e/notifications.mjs builds it). It shows nothing and needs no notification server: each
// notification it's asked to show is written to the file named in FAKE_NOTIFY_LOG (one JSON object a line),
// and a line "click <n> [action]" or "dismiss <n>" in the file named in FAKE_NOTIFY_CTL clicks or closes
// the n-th one shown (1, 2, …), as you would.
//
//   gcc -shared -fPIC -o libnotify.so.4 fake-libnotify.c $(pkg-config --cflags --libs gobject-2.0)
#include <glib-object.h>
#include <glib/gstdio.h>
#include <stdio.h>
#include <string.h>

typedef enum { NOTIFY_URGENCY_LOW, NOTIFY_URGENCY_NORMAL, NOTIFY_URGENCY_CRITICAL } NotifyUrgency;
typedef struct _NotifyNotification NotifyNotification;
typedef void (*NotifyActionCallback)(NotifyNotification *, char *, gpointer);
typedef struct { char *name; NotifyActionCallback cb; gpointer data; GFreeFunc free_func; } Action;

struct _NotifyNotification {
  GObject parent;
  int n, id, closed_reason, timeout, urgency, img_w, img_h;
  gboolean closed;
  char *summary, *body, *icon, *app;
  GString *hints;
  GPtrArray *actions;
};
typedef struct { GObjectClass parent_class; } NotifyNotificationClass;

G_DEFINE_TYPE(NotifyNotification, notify_notification, G_TYPE_OBJECT)

enum { PROP_0, PROP_ID, PROP_CLOSED_REASON, PROP_SUMMARY, PROP_BODY, PROP_ICON_NAME, PROP_APP_NAME };
static guint closed_signal;
static GPtrArray *shown;
static gboolean initted;
static char *app_name;

static void json_str(GString *out, const char *s) {
  g_string_append_c(out, '"');
  for (const unsigned char *p = (const unsigned char *)(s ? s : ""); *p; p++) {
    if (*p == '"' || *p == '\\') { g_string_append_c(out, '\\'); g_string_append_c(out, *p); }
    else if (*p < 0x20) g_string_append_printf(out, "\\u%04x", *p);
    else g_string_append_c(out, *p);
  }
  g_string_append_c(out, '"');
}

static void log_line(NotifyNotification *n, const char *event, const char *extra) {
  const char *path = g_getenv("FAKE_NOTIFY_LOG");
  if (!path) return;
  GString *s = g_string_new("{\"n\":");
  g_string_append_printf(s, "%d,\"event\":", n->n);
  json_str(s, event);
  if (!strcmp(event, "show")) {
    g_string_append(s, ",\"summary\":"); json_str(s, n->summary);
    g_string_append(s, ",\"body\":"); json_str(s, n->body);
    g_string_append(s, ",\"app\":"); json_str(s, n->app ? n->app : app_name);
    g_string_append_printf(s, ",\"image\":[%d,%d],\"timeout\":%d,\"urgency\":%d,\"id\":%d,\"actions\":[", n->img_w, n->img_h, n->timeout, n->urgency, n->id);
    for (guint i = 0; i < n->actions->len; i++) { if (i) g_string_append_c(s, ','); json_str(s, ((Action *)g_ptr_array_index(n->actions, i))->name); }
    g_string_append(s, "],\"hints\":{");
    g_string_append(s, n->hints->str);
    g_string_append_c(s, '}');
  }
  if (extra) { g_string_append(s, ",\"action\":"); json_str(s, extra); }
  g_string_append(s, "}\n");
  FILE *f = fopen(path, "a");
  if (f) { fputs(s->str, f); fclose(f); }
  g_string_free(s, TRUE);
}

static void action_free(gpointer p) {
  Action *a = p;
  if (a->free_func && a->data) a->free_func(a->data);
  g_free(a->name);
  g_free(a);
}

static void notify_notification_init(NotifyNotification *n) {
  n->timeout = -1;
  n->urgency = NOTIFY_URGENCY_NORMAL;
  n->hints = g_string_new("");
  n->actions = g_ptr_array_new_with_free_func(action_free);
}

static void finalize(GObject *o) {
  NotifyNotification *n = (NotifyNotification *)o;
  if (shown && n->n > 0 && (guint)n->n <= shown->len) g_ptr_array_index(shown, n->n - 1) = NULL;
  g_free(n->summary); g_free(n->body); g_free(n->icon); g_free(n->app);
  g_string_free(n->hints, TRUE);
  g_ptr_array_free(n->actions, TRUE);
  G_OBJECT_CLASS(notify_notification_parent_class)->finalize(o);
}

static void set_prop(GObject *o, guint id, const GValue *v, GParamSpec *ps) {
  NotifyNotification *n = (NotifyNotification *)o;
  switch (id) {
    case PROP_ID: n->id = g_value_get_int(v); break;
    case PROP_SUMMARY: g_free(n->summary); n->summary = g_value_dup_string(v); break;
    case PROP_BODY: g_free(n->body); n->body = g_value_dup_string(v); break;
    case PROP_ICON_NAME: g_free(n->icon); n->icon = g_value_dup_string(v); break;
    case PROP_APP_NAME: g_free(n->app); n->app = g_value_dup_string(v); break;
    default: G_OBJECT_WARN_INVALID_PROPERTY_ID(o, id, ps);
  }
}

static void get_prop(GObject *o, guint id, GValue *v, GParamSpec *ps) {
  NotifyNotification *n = (NotifyNotification *)o;
  switch (id) {
    case PROP_ID: g_value_set_int(v, n->id); break;
    case PROP_CLOSED_REASON: g_value_set_int(v, n->closed_reason); break;
    case PROP_SUMMARY: g_value_set_string(v, n->summary); break;
    case PROP_BODY: g_value_set_string(v, n->body); break;
    case PROP_ICON_NAME: g_value_set_string(v, n->icon); break;
    case PROP_APP_NAME: g_value_set_string(v, n->app); break;
    default: G_OBJECT_WARN_INVALID_PROPERTY_ID(o, id, ps);
  }
}

static void notify_notification_class_init(NotifyNotificationClass *k) {
  GObjectClass *o = G_OBJECT_CLASS(k);
  o->finalize = finalize;
  o->set_property = set_prop;
  o->get_property = get_prop;
  g_object_class_install_property(o, PROP_ID, g_param_spec_int("id", "id", "id", 0, G_MAXINT, 0, G_PARAM_READWRITE));
  g_object_class_install_property(o, PROP_CLOSED_REASON, g_param_spec_int("closed-reason", "closed-reason", "closed-reason", -1, G_MAXINT, -1, G_PARAM_READABLE));
  g_object_class_install_property(o, PROP_SUMMARY, g_param_spec_string("summary", "summary", "summary", NULL, G_PARAM_READWRITE));
  g_object_class_install_property(o, PROP_BODY, g_param_spec_string("body", "body", "body", NULL, G_PARAM_READWRITE));
  g_object_class_install_property(o, PROP_ICON_NAME, g_param_spec_string("icon-name", "icon-name", "icon-name", NULL, G_PARAM_READWRITE));
  g_object_class_install_property(o, PROP_APP_NAME, g_param_spec_string("app-name", "app-name", "app-name", NULL, G_PARAM_READWRITE));
  closed_signal = g_signal_new("closed", G_TYPE_FROM_CLASS(k), G_SIGNAL_RUN_FIRST, 0, NULL, NULL, NULL, G_TYPE_NONE, 0);
}

static gboolean emit_closed(gpointer p) {
  NotifyNotification *n = p;
  g_signal_emit(n, closed_signal, 0);
  g_object_unref(n);
  return G_SOURCE_REMOVE;
}

static void close_as(NotifyNotification *n, int reason) {
  if (n->closed) return;
  n->closed = TRUE;
  n->closed_reason = reason;
  g_idle_add(emit_closed, g_object_ref(n));
}

static gboolean poll_ctl(gpointer unused) {
  (void)unused;
  const char *path = g_getenv("FAKE_NOTIFY_CTL");
  char *text = NULL;
  if (!path || !g_file_get_contents(path, &text, NULL, NULL)) return G_SOURCE_CONTINUE;
  g_unlink(path);
  char **lines = g_strsplit(text, "\n", -1);
  for (char **l = lines; *l; l++) {
    char cmd[32] = "", action[128] = "";
    int k = 0;
    if (sscanf(*l, "%31s %d %127s", cmd, &k, action) < 2 || !shown || k < 1 || (guint)k > shown->len) continue;
    NotifyNotification *n = g_ptr_array_index(shown, k - 1);
    if (!n || n->closed) { FILE *f = g_getenv("FAKE_NOTIFY_LOG") ? fopen(g_getenv("FAKE_NOTIFY_LOG"), "a") : NULL; if (f) { fprintf(f, "{\"n\":%d,\"event\":\"gone\"}\n", k); fclose(f); } continue; }
    if (!strcmp(cmd, "click")) {
      const char *want = action[0] ? action : "default";
      for (guint i = 0; i < n->actions->len; i++) {
        Action *a = g_ptr_array_index(n->actions, i);
        if (strcmp(a->name, want)) continue;
        log_line(n, "clicked", want);
        g_object_ref(n);
        a->cb(n, a->name, a->data);
        g_object_unref(n);
        break;
      }
    } else if (!strcmp(cmd, "dismiss")) {
      log_line(n, "dismissed", NULL);
      close_as(n, 2);
    }
  }
  g_strfreev(lines);
  g_free(text);
  return G_SOURCE_CONTINUE;
}

gboolean notify_init(const char *name) {
  if (initted) return TRUE;
  initted = TRUE;
  app_name = g_strdup(name ? name : "");
  shown = g_ptr_array_new();
  g_timeout_add(100, poll_ctl, NULL);
  return TRUE;
}
void notify_uninit(void) { initted = FALSE; }
gboolean notify_is_initted(void) { return initted; }
const char *notify_get_app_name(void) { return app_name; }
void notify_set_app_name(const char *name) { g_free(app_name); app_name = g_strdup(name); }

GList *notify_get_server_caps(void) {
  GList *l = NULL;
  l = g_list_append(l, g_strdup("actions"));
  l = g_list_append(l, g_strdup("body"));
  return l;
}

gboolean notify_get_server_info(char **name, char **vendor, char **version, char **spec) {
  if (name) *name = g_strdup("fake-notify");
  if (vendor) *vendor = g_strdup("bifrost-tests");
  if (version) *version = g_strdup("1.0");
  if (spec) *spec = g_strdup("1.2");
  return TRUE;
}

NotifyNotification *notify_notification_new(const char *summary, const char *body, const char *icon) {
  NotifyNotification *n = g_object_new(notify_notification_get_type(), NULL);
  n->summary = g_strdup(summary);
  n->body = g_strdup(body);
  n->icon = g_strdup(icon);
  return n;
}

gboolean notify_notification_update(NotifyNotification *n, const char *summary, const char *body, const char *icon) {
  g_free(n->summary); n->summary = g_strdup(summary);
  g_free(n->body); n->body = g_strdup(body);
  g_free(n->icon); n->icon = g_strdup(icon);
  return TRUE;
}

void notify_notification_add_action(NotifyNotification *n, const char *action, const char *label, NotifyActionCallback cb, gpointer data, GFreeFunc free_func) {
  (void)label;
  Action *a = g_new0(Action, 1);
  a->name = g_strdup(action);
  a->cb = cb;
  a->data = data;
  a->free_func = free_func;
  g_ptr_array_add(n->actions, a);
}

void notify_notification_clear_actions(NotifyNotification *n) { g_ptr_array_set_size(n->actions, 0); }

void notify_notification_set_image_from_pixbuf(NotifyNotification *n, GObject *pixbuf) {
  n->img_w = n->img_h = 0;
  if (pixbuf) g_object_get(pixbuf, "width", &n->img_w, "height", &n->img_h, NULL);
}

void notify_notification_set_timeout(NotifyNotification *n, gint timeout) { n->timeout = timeout; }
void notify_notification_set_urgency(NotifyNotification *n, NotifyUrgency u) { n->urgency = u; }
void notify_notification_set_category(NotifyNotification *n, const char *c) { (void)n; (void)c; }
void notify_notification_set_app_name(NotifyNotification *n, const char *a) { g_free(n->app); n->app = g_strdup(a); }

void notify_notification_set_hint(NotifyNotification *n, const char *key, GVariant *value) {
  if (!value) return;
  g_variant_ref_sink(value);
  if (n->hints->len) g_string_append_c(n->hints, ',');
  json_str(n->hints, key);
  g_string_append_c(n->hints, ':');
  if (g_variant_is_of_type(value, G_VARIANT_TYPE_STRING)) json_str(n->hints, g_variant_get_string(value, NULL));
  else { char *p = g_variant_print(value, FALSE); json_str(n->hints, p); g_free(p); }
  g_variant_unref(value);
}

void notify_notification_set_hint_string(NotifyNotification *n, const char *key, const char *value) {
  notify_notification_set_hint(n, key, g_variant_new_string(value ? value : ""));
}

gboolean notify_notification_show(NotifyNotification *n, GError **error) {
  (void)error;
  if (!shown) notify_init("");
  if (n->n == 0) { g_ptr_array_add(shown, n); n->n = (int)shown->len; }
  n->closed = FALSE;
  log_line(n, "show", NULL);
  return TRUE;
}

gboolean notify_notification_close(NotifyNotification *n, GError **error) {
  (void)error;
  if (n->closed) return TRUE;
  log_line(n, "close", NULL);
  close_as(n, 3);
  return TRUE;
}

gint notify_notification_get_closed_reason(const NotifyNotification *n) { return n->closed_reason; }
const char *notify_notification_get_activation_token(NotifyNotification *n) { (void)n; return NULL; }
