import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:rally/data/services/theme_manager.dart';
import 'package:rally/domain/models/enums.dart';

void main() {
  late ThemeManager themeManager;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<ThemeManager> createManager({Map<String, Object>? values}) async {
    SharedPreferences.setMockInitialValues(values ?? {});
    final prefs = await SharedPreferences.getInstance();
    return ThemeManager(sharedPreferences: prefs);
  }

  group('ThemeManager', () {
    group('currentTheme', () {
      test('defaults to dark theme', () async {
        themeManager = await createManager();
        expect(themeManager.currentTheme, ThemeMode.dark);
      });
    });

    group('loadPersistedTheme', () {
      test('returns dark when no preference exists', () async {
        themeManager = await createManager();
        final result = await themeManager.loadPersistedTheme();
        expect(result, ThemeMode.dark);
        expect(themeManager.currentTheme, ThemeMode.dark);
      });

      test('returns dark when preference value is corrupted', () async {
        themeManager =
            await createManager(values: {'theme_mode': 'invalid_value'});
        final result = await themeManager.loadPersistedTheme();
        expect(result, ThemeMode.dark);
        expect(themeManager.currentTheme, ThemeMode.dark);
      });

      test('returns light when preference is light', () async {
        themeManager = await createManager(values: {'theme_mode': 'light'});
        final result = await themeManager.loadPersistedTheme();
        expect(result, ThemeMode.light);
        expect(themeManager.currentTheme, ThemeMode.light);
      });

      test('returns dark when preference is dark', () async {
        themeManager = await createManager(values: {'theme_mode': 'dark'});
        final result = await themeManager.loadPersistedTheme();
        expect(result, ThemeMode.dark);
        expect(themeManager.currentTheme, ThemeMode.dark);
      });
    });

    group('toggleTheme', () {
      test('toggles from dark to light', () async {
        themeManager = await createManager();
        expect(themeManager.currentTheme, ThemeMode.dark);

        await themeManager.toggleTheme();
        expect(themeManager.currentTheme, ThemeMode.light);
      });

      test('toggles from light to dark', () async {
        themeManager = await createManager(values: {'theme_mode': 'light'});
        await themeManager.loadPersistedTheme();
        expect(themeManager.currentTheme, ThemeMode.light);

        await themeManager.toggleTheme();
        expect(themeManager.currentTheme, ThemeMode.dark);
      });

      test('persists the new theme after toggling', () async {
        themeManager = await createManager();
        await themeManager.toggleTheme();

        // Verify the value was persisted
        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('theme_mode'), 'light');
      });
    });

    group('persistTheme', () {
      test('persists light theme correctly', () async {
        themeManager = await createManager();
        await themeManager.persistTheme(ThemeMode.light);

        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('theme_mode'), 'light');
        expect(themeManager.currentTheme, ThemeMode.light);
      });

      test('persists dark theme correctly', () async {
        themeManager = await createManager();
        await themeManager.persistTheme(ThemeMode.dark);

        final prefs = await SharedPreferences.getInstance();
        expect(prefs.getString('theme_mode'), 'dark');
        expect(themeManager.currentTheme, ThemeMode.dark);
      });

      test('updates in-memory value even when persisting', () async {
        themeManager = await createManager();
        expect(themeManager.currentTheme, ThemeMode.dark);

        await themeManager.persistTheme(ThemeMode.light);
        expect(themeManager.currentTheme, ThemeMode.light);
      });
    });

    group('round-trip', () {
      test('persist then load returns same theme (light)', () async {
        themeManager = await createManager();
        await themeManager.persistTheme(ThemeMode.light);

        // Create a new manager with the same prefs to simulate app restart
        final prefs = await SharedPreferences.getInstance();
        final newManager = ThemeManager(sharedPreferences: prefs);
        final loaded = await newManager.loadPersistedTheme();
        expect(loaded, ThemeMode.light);
      });

      test('persist then load returns same theme (dark)', () async {
        themeManager = await createManager();
        await themeManager.persistTheme(ThemeMode.dark);

        final prefs = await SharedPreferences.getInstance();
        final newManager = ThemeManager(sharedPreferences: prefs);
        final loaded = await newManager.loadPersistedTheme();
        expect(loaded, ThemeMode.dark);
      });
    });
  });
}
