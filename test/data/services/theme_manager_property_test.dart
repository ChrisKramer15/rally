import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/services/theme_manager.dart';
import 'package:rally/domain/models/enums.dart';

/// Feature: stock-trading-valuations-engine
/// Property-based tests for ThemeManager persistence round-trip
void main() {
  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 16: Theme persistence round-trip', () {
    // **Validates: Requirements 7.4**
    //
    // For any theme mode (light or dark), persisting the preference and then
    // loading it SHALL return the same theme mode.

    property(
        'persisting a theme and loading it in a new instance returns the same theme',
        () {
      forAll(
        integer(min: 0, max: 1),
        (value) async {
          // Generate a random ThemeMode (light or dark)
          final mode = value == 0 ? ThemeMode.light : ThemeMode.dark;

          // Set up mock SharedPreferences with empty initial values
          SharedPreferences.setMockInitialValues({});
          final prefs = await SharedPreferences.getInstance();

          // Create a ThemeManager and persist the theme
          final manager1 = ThemeManager(sharedPreferences: prefs);
          await manager1.persistTheme(mode);

          // Create a new ThemeManager instance (simulating app restart)
          // with the same SharedPreferences
          final manager2 = ThemeManager(sharedPreferences: prefs);
          final loadedMode = await manager2.loadPersistedTheme();

          // Assert the loaded value equals the originally persisted value
          expect(loadedMode, equals(mode),
              reason:
                  'Persisted $mode but loaded $loadedMode after simulated restart');
        },
        maxExamples: 100,
      );
    });
  });
}
