import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../domain/models/enums.dart';
import '../blocs/chart_bloc.dart';
import '../widgets/chart_widget.dart';
import '../widgets/time_duration_selector.dart';

/// Chart screen providing interactive candlestick/line chart display
/// with time duration selection.
///
/// Wraps [ChartWidget] and [TimeDurationSelector] into a cohesive screen.
class ChartScreen extends StatelessWidget {
  const ChartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Chart'),
        actions: [
          // Toggle chart type button
          BlocBuilder<ChartBloc, ChartState>(
            builder: (context, state) {
              final chartType = context.read<ChartBloc>().currentChartType;
              final isCandlestick = chartType == ChartType.candlestick;
              return IconButton(
                icon: Icon(
                  isCandlestick
                      ? Icons.candlestick_chart
                      : Icons.show_chart,
                ),
                tooltip: isCandlestick
                    ? 'Switch to line chart'
                    : 'Switch to candlestick chart',
                onPressed: () {
                  context.read<ChartBloc>().add(const ToggleChartType());
                },
              );
            },
          ),
        ],
      ),
      body: const Column(
        children: [
          Expanded(child: ChartWidget()),
          TimeDurationSelector(),
        ],
      ),
    );
  }
}
