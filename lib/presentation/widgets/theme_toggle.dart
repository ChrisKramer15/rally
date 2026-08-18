import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../blocs/theme_cubit.dart';

/// A toggle widget for switching between light and dark theme.
///
/// Displays a sun icon for light mode and a moon icon for dark mode.
/// Tapping toggles the theme immediately across all screens.
class ThemeToggle extends StatelessWidget {
  const ThemeToggle({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<ThemeCubit, ThemeState>(
      builder: (context, state) {
        final isDark = context.read<ThemeCubit>().isDarkMode;
        return IconButton(
          icon: Icon(
            isDark ? Icons.dark_mode : Icons.light_mode,
          ),
          tooltip: isDark ? 'Switch to light mode' : 'Switch to dark mode',
          onPressed: () {
            context.read<ThemeCubit>().toggleTheme();
          },
        );
      },
    );
  }
}
