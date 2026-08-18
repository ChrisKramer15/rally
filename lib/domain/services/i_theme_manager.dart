import '../models/enums.dart';

/// Abstract interface for managing light/dark theme switching and
/// persistence.
///
/// Handles toggling themes, persisting preferences to local storage,
/// and loading persisted preferences on startup. Defaults to dark theme
/// when no preference exists or the stored preference is corrupted.
abstract class IThemeManager {
  /// Get the current theme mode (light or dark).
  ThemeMode get currentTheme;

  /// Toggle between light and dark themes.
  ///
  /// Persists the new preference to local storage within 1 second.
  Future<void> toggleTheme();

  /// Load the persisted theme preference from local storage.
  ///
  /// Returns [ThemeMode.dark] if the preference is unreadable or corrupted.
  Future<ThemeMode> loadPersistedTheme();

  /// Persist the given [mode] to local storage.
  ///
  /// Handles write failures gracefully by applying in memory and retrying.
  Future<void> persistTheme(ThemeMode mode);
}
