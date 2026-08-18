import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/enums.dart';
import '../../domain/services/i_theme_manager.dart';

// --- State ---

/// State for the ThemeCubit containing the current theme mode.
class ThemeState extends Equatable {
  final ThemeMode themeMode;

  const ThemeState({required this.themeMode});

  @override
  List<Object?> get props => [themeMode];
}

// --- Cubit ---

/// Cubit that manages the app-wide theme mode (light/dark).
///
/// Listens to [IThemeManager] for persistence and provides reactive
/// theme switching without requiring an app restart.
class ThemeCubit extends Cubit<ThemeState> {
  final IThemeManager _themeManager;

  ThemeCubit({required IThemeManager themeManager})
      : _themeManager = themeManager,
        super(ThemeState(themeMode: themeManager.currentTheme));

  /// Load the persisted theme preference on app startup.
  ///
  /// Defaults to [ThemeMode.dark] if no preference is stored or the
  /// stored preference is corrupted.
  Future<void> loadTheme() async {
    final mode = await _themeManager.loadPersistedTheme();
    emit(ThemeState(themeMode: mode));
  }

  /// Toggle between light and dark themes.
  ///
  /// Immediately emits the new theme state and persists the preference.
  Future<void> toggleTheme() async {
    await _themeManager.toggleTheme();
    emit(ThemeState(themeMode: _themeManager.currentTheme));
  }

  /// Whether the current theme is dark mode.
  bool get isDarkMode => state.themeMode == ThemeMode.dark;
}
