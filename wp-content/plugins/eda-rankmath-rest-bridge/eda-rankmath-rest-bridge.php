<?php
/**
 * Plugin Name: EDA Rank Math REST Bridge
 * Description: Espone i principali meta Rank Math via REST API per sincronizzazione contenuti da pipeline esterna.
 * Version: 0.1.0
 * Author: Easy Digital Agency
 */

if (!defined('ABSPATH')) {
    exit;
}

final class EDA_RankMath_REST_Bridge {
    /**
     * Rank Math meta keys usati nella pipeline contenuti.
     */
    private const META_KEYS = [
        'rank_math_title',
        'rank_math_description',
        'rank_math_focus_keyword',
        'rank_math_canonical_url',
    ];

    public static function init(): void {
        add_action('init', [__CLASS__, 'register_meta_for_rest']);
    }

    public static function register_meta_for_rest(): void {
        $post_types = get_post_types(['show_in_rest' => true], 'names');

        foreach ($post_types as $post_type) {
            foreach (self::META_KEYS as $meta_key) {
                register_post_meta($post_type, $meta_key, [
                    'type' => 'string',
                    'single' => true,
                    'show_in_rest' => true,
                    'sanitize_callback' => [__CLASS__, 'sanitize_meta'],
                    'auth_callback' => [__CLASS__, 'auth_can_edit_post'],
                ]);
            }
        }
    }

    public static function sanitize_meta($value, string $meta_key, string $object_type) {
        if (!is_scalar($value)) {
            return '';
        }

        $value = (string) $value;
        if ($meta_key === 'rank_math_canonical_url') {
            return esc_url_raw($value);
        }

        return sanitize_text_field($value);
    }

    public static function auth_can_edit_post(bool $allowed, string $meta_key, int $post_id, int $user_id): bool {
        // Con Application Password / auth REST l'utente e gia autenticato:
        // limitiamo la scrittura ai soli utenti che possono modificare il post.
        return user_can($user_id, 'edit_post', $post_id);
    }
}

EDA_RankMath_REST_Bridge::init();
