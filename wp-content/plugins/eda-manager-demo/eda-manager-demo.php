<?php
/**
 * Plugin Name: EDA Manager Demo
 * Description: Demo gestionale clienti/servizi/rinnovi/ticket con area cliente e reminder email.
 * Version: 0.1.0
 * Author: Easy Digital Agency
 */

if (!defined('ABSPATH')) {
    exit;
}

final class EDA_Manager_Demo {
    const VERSION = '0.1.0';
    const CRON_HOOK = 'eda_manager_daily_reminders';

    public static function init() {
        register_activation_hook(__FILE__, [__CLASS__, 'activate']);
        register_deactivation_hook(__FILE__, [__CLASS__, 'deactivate']);

        add_action('admin_menu', [__CLASS__, 'register_admin_menu']);
        add_action('admin_init', [__CLASS__, 'handle_admin_actions']);

        add_shortcode('eda_client_portal', [__CLASS__, 'shortcode_client_portal']);
        add_shortcode('eda_service_pricing', [__CLASS__, 'shortcode_service_pricing']);

        add_action('init', [__CLASS__, 'handle_front_actions']);
        add_action(self::CRON_HOOK, [__CLASS__, 'send_renewal_reminders']);
    }

    public static function activate() {
        self::create_tables();
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', self::CRON_HOOK);
        }
    }

    public static function deactivate() {
        wp_clear_scheduled_hook(self::CRON_HOOK);
    }

    private static function table_services() {
        global $wpdb;
        return $wpdb->prefix . 'eda_services';
    }

    private static function table_customer_services() {
        global $wpdb;
        return $wpdb->prefix . 'eda_customer_services';
    }

    private static function table_tickets() {
        global $wpdb;
        return $wpdb->prefix . 'eda_tickets';
    }

    private static function create_tables() {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset = $wpdb->get_charset_collate();
        $services = self::table_services();
        $customer_services = self::table_customer_services();
        $tickets = self::table_tickets();

        $sql_services = "CREATE TABLE {$services} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(190) NOT NULL,
            description TEXT NULL,
            price DECIMAL(10,2) NOT NULL DEFAULT 0,
            billing_type VARCHAR(20) NOT NULL DEFAULT 'one_time',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
        ) {$charset};";

        $sql_customer_services = "CREATE TABLE {$customer_services} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            service_id BIGINT UNSIGNED NOT NULL,
            purchase_date DATE NOT NULL,
            renewal_date DATE NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            notes TEXT NULL,
            last_reminder_sent DATE NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_user_id (user_id),
            KEY idx_service_id (service_id),
            KEY idx_renewal_date (renewal_date)
        ) {$charset};";

        $sql_tickets = "CREATE TABLE {$tickets} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT UNSIGNED NOT NULL,
            subject VARCHAR(255) NOT NULL,
            message LONGTEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'open',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NULL,
            PRIMARY KEY (id),
            KEY idx_user_id (user_id),
            KEY idx_status (status)
        ) {$charset};";

        dbDelta($sql_services);
        dbDelta($sql_customer_services);
        dbDelta($sql_tickets);
    }

    public static function register_admin_menu() {
        add_menu_page(
            'EDA Manager',
            'EDA Manager',
            'manage_options',
            'eda-manager',
            [__CLASS__, 'render_dashboard_page'],
            'dashicons-portfolio',
            56
        );

        add_submenu_page('eda-manager', 'Dashboard', 'Dashboard', 'manage_options', 'eda-manager', [__CLASS__, 'render_dashboard_page']);
        add_submenu_page('eda-manager', 'Servizi', 'Servizi', 'manage_options', 'eda-manager-services', [__CLASS__, 'render_services_page']);
        add_submenu_page('eda-manager', 'Clienti', 'Clienti', 'manage_options', 'eda-manager-customers', [__CLASS__, 'render_customers_page']);
        add_submenu_page('eda-manager', 'Rinnovi', 'Rinnovi', 'manage_options', 'eda-manager-renewals', [__CLASS__, 'render_renewals_page']);
        add_submenu_page('eda-manager', 'Ticket', 'Ticket', 'manage_options', 'eda-manager-tickets', [__CLASS__, 'render_tickets_page']);
    }

    public static function handle_admin_actions() {
        if (!current_user_can('manage_options')) {
            return;
        }

        if (!isset($_POST['eda_action']) || !isset($_POST['_wpnonce'])) {
            return;
        }

        $action = sanitize_text_field(wp_unslash($_POST['eda_action']));

        if (!wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['_wpnonce'])), 'eda_manager_action')) {
            return;
        }

        switch ($action) {
            case 'add_service':
                self::admin_add_service();
                break;
            case 'assign_service':
                self::admin_assign_service();
                break;
            case 'update_ticket_status':
                self::admin_update_ticket_status();
                break;
        }
    }

    private static function admin_add_service() {
        global $wpdb;
        $name = isset($_POST['name']) ? sanitize_text_field(wp_unslash($_POST['name'])) : '';
        $description = isset($_POST['description']) ? sanitize_textarea_field(wp_unslash($_POST['description'])) : '';
        $price = isset($_POST['price']) ? (float) wp_unslash($_POST['price']) : 0;
        $billing_type = isset($_POST['billing_type']) ? sanitize_text_field(wp_unslash($_POST['billing_type'])) : 'one_time';
        $billing_type = in_array($billing_type, ['one_time', 'annual'], true) ? $billing_type : 'one_time';

        if ($name === '') {
            return;
        }

        $wpdb->insert(self::table_services(), [
            'name' => $name,
            'description' => $description,
            'price' => $price,
            'billing_type' => $billing_type,
            'is_active' => 1,
        ], ['%s', '%s', '%f', '%s', '%d']);
    }

    private static function admin_assign_service() {
        global $wpdb;
        $user_id = isset($_POST['user_id']) ? (int) $_POST['user_id'] : 0;
        $service_id = isset($_POST['service_id']) ? (int) $_POST['service_id'] : 0;
        $purchase_date = isset($_POST['purchase_date']) ? sanitize_text_field(wp_unslash($_POST['purchase_date'])) : '';
        $renewal_date = isset($_POST['renewal_date']) ? sanitize_text_field(wp_unslash($_POST['renewal_date'])) : null;
        $status = isset($_POST['status']) ? sanitize_text_field(wp_unslash($_POST['status'])) : 'active';
        $notes = isset($_POST['notes']) ? sanitize_textarea_field(wp_unslash($_POST['notes'])) : '';

        if ($user_id <= 0 || $service_id <= 0 || $purchase_date === '') {
            return;
        }

        $wpdb->insert(self::table_customer_services(), [
            'user_id' => $user_id,
            'service_id' => $service_id,
            'purchase_date' => $purchase_date,
            'renewal_date' => ($renewal_date !== '') ? $renewal_date : null,
            'status' => $status,
            'notes' => $notes,
        ], ['%d', '%d', '%s', '%s', '%s', '%s']);
    }

    private static function admin_update_ticket_status() {
        global $wpdb;
        $ticket_id = isset($_POST['ticket_id']) ? (int) $_POST['ticket_id'] : 0;
        $status = isset($_POST['status']) ? sanitize_text_field(wp_unslash($_POST['status'])) : 'open';
        if ($ticket_id <= 0) {
            return;
        }
        $status = in_array($status, ['open', 'in_progress', 'closed'], true) ? $status : 'open';

        $wpdb->update(
            self::table_tickets(),
            ['status' => $status, 'updated_at' => current_time('mysql')],
            ['id' => $ticket_id],
            ['%s', '%s'],
            ['%d']
        );
    }

    public static function handle_front_actions() {
        if (!is_user_logged_in()) {
            return;
        }
        if (!isset($_POST['eda_front_action']) || !isset($_POST['_wpnonce'])) {
            return;
        }
        if (!wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['_wpnonce'])), 'eda_front_action')) {
            return;
        }

        $action = sanitize_text_field(wp_unslash($_POST['eda_front_action']));
        if ($action === 'create_ticket') {
            self::front_create_ticket();
        }
    }

    private static function front_create_ticket() {
        global $wpdb;
        $subject = isset($_POST['subject']) ? sanitize_text_field(wp_unslash($_POST['subject'])) : '';
        $message = isset($_POST['message']) ? sanitize_textarea_field(wp_unslash($_POST['message'])) : '';
        if ($subject === '' || $message === '') {
            return;
        }

        $wpdb->insert(self::table_tickets(), [
            'user_id' => get_current_user_id(),
            'subject' => $subject,
            'message' => $message,
            'status' => 'open',
        ], ['%d', '%s', '%s', '%s']);
    }

    public static function render_dashboard_page() {
        global $wpdb;
        $total_clients = count_users();
        $active_services = (int) $wpdb->get_var("SELECT COUNT(*) FROM " . self::table_customer_services() . " WHERE status='active'");
        $open_tickets = (int) $wpdb->get_var("SELECT COUNT(*) FROM " . self::table_tickets() . " WHERE status IN ('open','in_progress')");
        $renewing_30 = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM " . self::table_customer_services() . " WHERE renewal_date IS NOT NULL AND renewal_date BETWEEN %s AND %s",
            current_time('Y-m-d'),
            gmdate('Y-m-d', strtotime('+30 days'))
        ));

        echo '<div class="wrap"><h1>EDA Manager - Dashboard</h1>';
        echo '<p>Demo gestionale: clienti, servizi, rinnovi, ticket.</p>';
        echo '<ul style="font-size:16px;line-height:1.9">';
        echo '<li><strong>Utenti WordPress:</strong> ' . esc_html((string) $total_clients['total_users']) . '</li>';
        echo '<li><strong>Servizi attivi:</strong> ' . esc_html((string) $active_services) . '</li>';
        echo '<li><strong>Rinnovi entro 30 giorni:</strong> ' . esc_html((string) $renewing_30) . '</li>';
        echo '<li><strong>Ticket aperti/in lavorazione:</strong> ' . esc_html((string) $open_tickets) . '</li>';
        echo '</ul></div>';
    }

    public static function render_services_page() {
        global $wpdb;
        $table = self::table_services();
        $services = $wpdb->get_results("SELECT * FROM {$table} ORDER BY id DESC");

        echo '<div class="wrap"><h1>EDA Manager - Servizi</h1>';
        echo '<h2>Aggiungi servizio</h2>';
        echo '<form method="post">';
        wp_nonce_field('eda_manager_action');
        echo '<input type="hidden" name="eda_action" value="add_service" />';
        echo '<table class="form-table"><tbody>';
        echo '<tr><th>Nome</th><td><input name="name" type="text" class="regular-text" required></td></tr>';
        echo '<tr><th>Descrizione</th><td><textarea name="description" class="large-text" rows="3"></textarea></td></tr>';
        echo '<tr><th>Prezzo</th><td><input name="price" type="number" step="0.01" min="0" value="0"></td></tr>';
        echo '<tr><th>Tipo</th><td><select name="billing_type"><option value="one_time">Una tantum</option><option value="annual">Rinnovo annuale</option></select></td></tr>';
        echo '</tbody></table>';
        submit_button('Salva servizio');
        echo '</form>';

        echo '<h2>Lista servizi</h2>';
        echo '<table class="widefat striped"><thead><tr><th>ID</th><th>Nome</th><th>Prezzo</th><th>Tipo</th><th>Attivo</th></tr></thead><tbody>';
        foreach ($services as $s) {
            echo '<tr>';
            echo '<td>' . esc_html((string) $s->id) . '</td>';
            echo '<td>' . esc_html($s->name) . '</td>';
            echo '<td>€ ' . esc_html(number_format((float) $s->price, 2, ',', '.')) . '</td>';
            echo '<td>' . esc_html($s->billing_type === 'annual' ? 'Rinnovo annuale' : 'Una tantum') . '</td>';
            echo '<td>' . esc_html((string) $s->is_active) . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table></div>';
    }

    public static function render_customers_page() {
        global $wpdb;
        $users = get_users(['orderby' => 'display_name', 'order' => 'ASC']);
        $services = $wpdb->get_results('SELECT id,name FROM ' . self::table_services() . ' WHERE is_active=1 ORDER BY name ASC');
        $rows = $wpdb->get_results(
            'SELECT cs.*, u.display_name, u.user_email, s.name AS service_name, s.billing_type, s.price
             FROM ' . self::table_customer_services() . ' cs
             JOIN ' . $wpdb->users . ' u ON u.ID = cs.user_id
             JOIN ' . self::table_services() . ' s ON s.id = cs.service_id
             ORDER BY cs.id DESC'
        );

        echo '<div class="wrap"><h1>EDA Manager - Clienti</h1>';
        echo '<h2>Assegna servizio a cliente</h2>';
        echo '<form method="post">';
        wp_nonce_field('eda_manager_action');
        echo '<input type="hidden" name="eda_action" value="assign_service" />';
        echo '<table class="form-table"><tbody>';
        echo '<tr><th>Cliente</th><td><select name="user_id" required><option value="">Seleziona</option>';
        foreach ($users as $u) {
            echo '<option value="' . esc_attr((string) $u->ID) . '">' . esc_html($u->display_name . ' (' . $u->user_email . ')') . '</option>';
        }
        echo '</select></td></tr>';

        echo '<tr><th>Servizio</th><td><select name="service_id" required><option value="">Seleziona</option>';
        foreach ($services as $s) {
            echo '<option value="' . esc_attr((string) $s->id) . '">' . esc_html($s->name) . '</option>';
        }
        echo '</select></td></tr>';

        echo '<tr><th>Data acquisto</th><td><input type="date" name="purchase_date" required></td></tr>';
        echo '<tr><th>Data rinnovo</th><td><input type="date" name="renewal_date"></td></tr>';
        echo '<tr><th>Stato</th><td><select name="status"><option value="active">Attivo</option><option value="expired">Scaduto</option><option value="cancelled">Annullato</option></select></td></tr>';
        echo '<tr><th>Note</th><td><textarea name="notes" class="large-text" rows="3"></textarea></td></tr>';
        echo '</tbody></table>';
        submit_button('Assegna servizio');
        echo '</form>';

        echo '<h2>Storico servizi clienti</h2>';
        echo '<table class="widefat striped"><thead><tr><th>Cliente</th><th>Servizio</th><th>Tipo</th><th>Prezzo</th><th>Acquisto</th><th>Rinnovo</th><th>Stato</th></tr></thead><tbody>';
        foreach ($rows as $r) {
            echo '<tr>';
            echo '<td>' . esc_html($r->display_name . ' - ' . $r->user_email) . '</td>';
            echo '<td>' . esc_html($r->service_name) . '</td>';
            echo '<td>' . esc_html($r->billing_type === 'annual' ? 'Annuale' : 'Una tantum') . '</td>';
            echo '<td>€ ' . esc_html(number_format((float) $r->price, 2, ',', '.')) . '</td>';
            echo '<td>' . esc_html($r->purchase_date) . '</td>';
            echo '<td>' . esc_html((string) $r->renewal_date) . '</td>';
            echo '<td>' . esc_html($r->status) . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table></div>';
    }

    public static function render_renewals_page() {
        global $wpdb;
        $from = current_time('Y-m-d');
        $to = gmdate('Y-m-d', strtotime('+90 days'));
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT cs.*, u.display_name, u.user_email, s.name AS service_name
             FROM ' . self::table_customer_services() . ' cs
             JOIN ' . $wpdb->users . ' u ON u.ID = cs.user_id
             JOIN ' . self::table_services() . ' s ON s.id = cs.service_id
             WHERE cs.renewal_date IS NOT NULL AND cs.renewal_date BETWEEN %s AND %s
             ORDER BY cs.renewal_date ASC',
            $from,
            $to
        ));

        echo '<div class="wrap"><h1>EDA Manager - Rinnovi in Scadenza</h1>';
        echo '<p>Elenco rinnovi nei prossimi 90 giorni.</p>';
        echo '<table class="widefat striped"><thead><tr><th>Data rinnovo</th><th>Cliente</th><th>Email</th><th>Servizio</th><th>Stato</th></tr></thead><tbody>';
        foreach ($rows as $r) {
            echo '<tr>';
            echo '<td>' . esc_html((string) $r->renewal_date) . '</td>';
            echo '<td>' . esc_html($r->display_name) . '</td>';
            echo '<td>' . esc_html($r->user_email) . '</td>';
            echo '<td>' . esc_html($r->service_name) . '</td>';
            echo '<td>' . esc_html($r->status) . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table></div>';
    }

    public static function render_tickets_page() {
        global $wpdb;
        $rows = $wpdb->get_results(
            'SELECT t.*, u.display_name, u.user_email
             FROM ' . self::table_tickets() . ' t
             JOIN ' . $wpdb->users . ' u ON u.ID = t.user_id
             ORDER BY t.id DESC'
        );

        echo '<div class="wrap"><h1>EDA Manager - Ticket</h1>';
        echo '<table class="widefat striped"><thead><tr><th>ID</th><th>Cliente</th><th>Oggetto</th><th>Messaggio</th><th>Stato</th><th>Azione</th></tr></thead><tbody>';
        foreach ($rows as $r) {
            echo '<tr>';
            echo '<td>' . esc_html((string) $r->id) . '</td>';
            echo '<td>' . esc_html($r->display_name . ' (' . $r->user_email . ')') . '</td>';
            echo '<td>' . esc_html($r->subject) . '</td>';
            echo '<td>' . esc_html(wp_trim_words($r->message, 18)) . '</td>';
            echo '<td>' . esc_html($r->status) . '</td>';
            echo '<td><form method="post" style="display:flex;gap:8px;align-items:center">';
            wp_nonce_field('eda_manager_action');
            echo '<input type="hidden" name="eda_action" value="update_ticket_status" />';
            echo '<input type="hidden" name="ticket_id" value="' . esc_attr((string) $r->id) . '" />';
            echo '<select name="status"><option value="open">Open</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select>';
            echo '<button class="button button-primary" type="submit">Aggiorna</button>';
            echo '</form></td>';
            echo '</tr>';
        }
        echo '</tbody></table></div>';
    }

    public static function shortcode_client_portal() {
        if (!is_user_logged_in()) {
            return '<p>Devi effettuare il login per accedere all\'area cliente.</p>';
        }

        global $wpdb;
        $user_id = get_current_user_id();
        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT cs.*, s.name AS service_name, s.billing_type, s.price
             FROM ' . self::table_customer_services() . ' cs
             JOIN ' . self::table_services() . ' s ON s.id = cs.service_id
             WHERE cs.user_id = %d
             ORDER BY cs.purchase_date DESC',
            $user_id
        ));

        $tickets = $wpdb->get_results($wpdb->prepare(
            'SELECT * FROM ' . self::table_tickets() . ' WHERE user_id=%d ORDER BY id DESC',
            $user_id
        ));

        ob_start();
        ?>
        <div class="eda-client-portal" style="max-width:1000px;margin:0 auto">
            <h2>I tuoi servizi</h2>
            <table style="width:100%;border-collapse:collapse;margin-bottom:28px">
                <thead>
                    <tr>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Servizio</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Tipo</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Prezzo</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Acquisto</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Rinnovo</th>
                        <th style="text-align:left;border-bottom:1px solid #ddd;padding:8px">Stato</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($rows as $r): ?>
                    <tr>
                        <td style="padding:8px;border-bottom:1px solid #eee"><?php echo esc_html($r->service_name); ?></td>
                        <td style="padding:8px;border-bottom:1px solid #eee"><?php echo esc_html($r->billing_type === 'annual' ? 'Annuale' : 'Una tantum'); ?></td>
                        <td style="padding:8px;border-bottom:1px solid #eee">€ <?php echo esc_html(number_format((float) $r->price, 2, ',', '.')); ?></td>
                        <td style="padding:8px;border-bottom:1px solid #eee"><?php echo esc_html($r->purchase_date); ?></td>
                        <td style="padding:8px;border-bottom:1px solid #eee"><?php echo esc_html((string) $r->renewal_date); ?></td>
                        <td style="padding:8px;border-bottom:1px solid #eee"><?php echo esc_html($r->status); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>

            <h2>Apri un ticket</h2>
            <form method="post" style="margin-bottom:24px">
                <?php wp_nonce_field('eda_front_action'); ?>
                <input type="hidden" name="eda_front_action" value="create_ticket" />
                <p><input type="text" name="subject" placeholder="Oggetto" required style="width:100%;padding:10px"></p>
                <p><textarea name="message" placeholder="Descrivi la richiesta" rows="5" required style="width:100%;padding:10px"></textarea></p>
                <p><button type="submit" style="padding:10px 16px;background:#3dae63;color:#fff;border:0;border-radius:6px">Invia ticket</button></p>
            </form>

            <h2>I tuoi ticket</h2>
            <ul>
                <?php foreach ($tickets as $t): ?>
                    <li><strong><?php echo esc_html($t->subject); ?></strong> - <?php echo esc_html($t->status); ?> (<?php echo esc_html($t->created_at); ?>)</li>
                <?php endforeach; ?>
            </ul>
        </div>
        <?php
        return (string) ob_get_clean();
    }

    public static function shortcode_service_pricing() {
        global $wpdb;
        $rows = $wpdb->get_results('SELECT * FROM ' . self::table_services() . ' WHERE is_active=1 ORDER BY price ASC');
        if (!$rows) {
            return '<p>Nessun pacchetto disponibile al momento.</p>';
        }

        ob_start();
        echo '<table style="width:100%;border-collapse:collapse">';
        echo '<thead><tr><th style="text-align:left;padding:10px;border-bottom:1px solid #ddd">Servizio</th><th style="text-align:left;padding:10px;border-bottom:1px solid #ddd">Prezzo</th><th style="text-align:left;padding:10px;border-bottom:1px solid #ddd">Tipo</th></tr></thead><tbody>';
        foreach ($rows as $r) {
            echo '<tr>';
            echo '<td style="padding:10px;border-bottom:1px solid #eee">' . esc_html($r->name) . '</td>';
            echo '<td style="padding:10px;border-bottom:1px solid #eee">€ ' . esc_html(number_format((float) $r->price, 2, ',', '.')) . '</td>';
            echo '<td style="padding:10px;border-bottom:1px solid #eee">' . esc_html($r->billing_type === 'annual' ? 'Annuale' : 'Una tantum') . '</td>';
            echo '</tr>';
        }
        echo '</tbody></table>';
        return (string) ob_get_clean();
    }

    public static function send_renewal_reminders() {
        global $wpdb;
        $today = current_time('Y-m-d');
        $plus7 = gmdate('Y-m-d', strtotime('+7 days'));

        $rows = $wpdb->get_results($wpdb->prepare(
            'SELECT cs.*, u.user_email, u.display_name, s.name AS service_name
             FROM ' . self::table_customer_services() . ' cs
             JOIN ' . $wpdb->users . ' u ON u.ID = cs.user_id
             JOIN ' . self::table_services() . ' s ON s.id = cs.service_id
             WHERE cs.status = %s
               AND cs.renewal_date IS NOT NULL
               AND cs.renewal_date BETWEEN %s AND %s
               AND (cs.last_reminder_sent IS NULL OR cs.last_reminder_sent < %s)',
            'active',
            $today,
            $plus7,
            $today
        ));

        foreach ($rows as $r) {
            $subject = '[Easy Digital Agency] Promemoria rinnovo servizio';
            $message = "Ciao {$r->display_name},\n\n";
            $message .= "Ti ricordiamo che il servizio '{$r->service_name}' ha rinnovo previsto il {$r->renewal_date}.\n";
            $message .= "Se vuoi supporto, rispondi a questa email o contattaci dalla tua area cliente.\n\n";
            $message .= "Easy Digital Agency";

            wp_mail($r->user_email, $subject, $message);

            $wpdb->update(
                self::table_customer_services(),
                ['last_reminder_sent' => $today],
                ['id' => $r->id],
                ['%s'],
                ['%d']
            );
        }
    }
}

EDA_Manager_Demo::init();
