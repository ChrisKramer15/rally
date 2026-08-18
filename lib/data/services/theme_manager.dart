import 'package:shared_preferences/shared_preferences.dart';

import '../../domain/models/enums.dart';
import '../../domain/services/i_theme_manager.dart';

/// Key used to store the theme preference in SharedPreferences.
const String _themePreferenceKey = 'theme_mode';

/// Concrete implementation of [IThemeManager] using SharedPreferences
/// for persistence.
///
/// Defaults to [ThemeMode.dark] when no preference exists or the stored
/// value is corrupted/unreadable.
class ThemeManager implements IThemeManager {
  ThemeManager({required SharedPreferences sharedPreferences})
      : _prefs = sharedPreferences,
        _currentTheme = ThemeMode.dark;

  final SharedPreferences _prefs;
  ThemeMode _currentTheme;

  @override
  ThemeMode get currentTheme => _currentTheme;

  @override
  Future<void> toggleTheme() async {
    _currentTheme =
        _currentTheme == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark;
    await persistTheme(_currentTheme);
  }

  @override
  Future<ThemeMode> loadPersistedTheme() async {
    try {
      final value = _prefs.getString(_themePreferenceKey);
      if (value == 'light') {
        _currentTheme = ThemeMode.light;
      } else if (value == 'dark') {
        _currentTheme = ThemeMode.dark;
      } else {
        // Key doesn't exist or value is corrupted — default to dark.
        _currentTheme = ThemeMode.dark;
      }
    } catch (_) {
      // Unreadable preference — default to dark.
      _currentTheme = ThemeMode.dark;
    }
    return _currentTheme;
  }

  @override
  Future<void> persistTheme(ThemeMode mode) async {
    _currentTheme = mode;
    final value = mode == ThemeMode.light ? 'light' : 'dark';

    try {
      final success = await _prefs.setString(_themePreferenceKey, value);
      if (!success) {
        // First attempt failed — retry once.
        await _prefs.setString(_themePreferenceKey, value);
      }
    } catch (_) {
      // Write failure — theme is already applied in memory.
      // Retry once.
      try {
        await _prefs.setString(_themePreferenceKey, value);
      } catch (_) {
        // Second attempt also failed. Theme remains applied in memory only.
      }
    }
  }
}
