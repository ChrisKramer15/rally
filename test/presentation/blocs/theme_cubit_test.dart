import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/services/i_theme_manager.dart';
import 'package:rally/presentation/blocs/theme_cubit.dart';

// --- Mocks ---

class MockThemeManager extends Mock implements IThemeManager {}

void main() {
  late MockThemeManager mockThemeManager;

  setUp(() {
    mockThemeManager = MockThemeManager();
  });

  ThemeCubit buildCubit({ThemeMode initialTheme = ThemeMode.dark}) {
    when(() => mockThemeManager.currentTheme).thenReturn(initialTheme);
    return ThemeCubit(themeManager: mockThemeManager);
  }

  group('ThemeCubit', () {
    test('initial state defaults to dark theme from ThemeManager', () {
      final cubit = buildCubit();
      expect(cubit.state.themeMode, equals(ThemeMode.dark));
      expect(cubit.isDarkMode, isTrue);
    });

    test('initial state uses ThemeManager current theme (light)', () {
      final cubit = buildCubit(initialTheme: ThemeMode.light);
      expect(cubit.state.themeMode, equals(ThemeMode.light));
      expect(cubit.isDarkMode, isFalse);
    });

    blocTest<ThemeCubit, ThemeState>(
      'loadTheme emits persisted theme from ThemeManager',
      build: () {
        when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.dark);
        when(() => mockThemeManager.loadPersistedTheme())
            .thenAnswer((_) async => ThemeMode.light);
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) => cubit.loadTheme(),
      expect: () => [
        const ThemeState(themeMode: ThemeMode.light),
      ],
    );

    blocTest<ThemeCubit, ThemeState>(
      'loadTheme defaults to dark when preference is corrupted',
      build: () {
        when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.dark);
        when(() => mockThemeManager.loadPersistedTheme())
            .thenAnswer((_) async => ThemeMode.dark);
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) => cubit.loadTheme(),
      expect: () => [
        const ThemeState(themeMode: ThemeMode.dark),
      ],
    );

    blocTest<ThemeCubit, ThemeState>(
      'toggleTheme switches from dark to light',
      build: () {
        when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.dark);
        when(() => mockThemeManager.toggleTheme()).thenAnswer((_) async {
          when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.light);
        });
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) => cubit.toggleTheme(),
      expect: () => [
        const ThemeState(themeMode: ThemeMode.light),
      ],
    );

    blocTest<ThemeCubit, ThemeState>(
      'toggleTheme switches from light to dark',
      build: () {
        when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.light);
        when(() => mockThemeManager.toggleTheme()).thenAnswer((_) async {
          when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.dark);
        });
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) => cubit.toggleTheme(),
      expect: () => [
        const ThemeState(themeMode: ThemeMode.dark),
      ],
    );

    blocTest<ThemeCubit, ThemeState>(
      'toggleTheme calls themeManager.toggleTheme for persistence',
      build: () {
        when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.dark);
        when(() => mockThemeManager.toggleTheme()).thenAnswer((_) async {
          when(() => mockThemeManager.currentTheme).thenReturn(ThemeMode.light);
        });
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) => cubit.toggleTheme(),
      verify: (_) {
        verify(() => mockThemeManager.toggleTheme()).called(1);
      },
    );

    blocTest<ThemeCubit, ThemeState>(
      'double toggle returns to original theme',
      build: () {
        var current = ThemeMode.dark;
        when(() => mockThemeManager.currentTheme)
            .thenAnswer((_) => current);
        when(() => mockThemeManager.toggleTheme()).thenAnswer((_) async {
          current = current == ThemeMode.dark
              ? ThemeMode.light
              : ThemeMode.dark;
        });
        return ThemeCubit(themeManager: mockThemeManager);
      },
      act: (cubit) async {
        await cubit.toggleTheme();
        await cubit.toggleTheme();
      },
      expect: () => [
        const ThemeState(themeMode: ThemeMode.light),
        const ThemeState(themeMode: ThemeMode.dark),
      ],
    );
  });
}
