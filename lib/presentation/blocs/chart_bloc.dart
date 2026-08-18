import 'package:equatable/equatable.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../data/repositories/market_data_repository.dart';
import '../../domain/models/enums.dart';
import '../../domain/models/ohlc_candle.dart';

// --- Events ---

/// Base event for the ChartBLoC.
sealed class ChartEvent extends Equatable {
  const ChartEvent();

  @override
  List<Object?> get props => [];
}

/// Load chart data for the given [symbol].
class LoadChart extends ChartEvent {
  final String symbol;

  const LoadChart(this.symbol);

  @override
  List<Object?> get props => [symbol];
}

/// Toggle chart type between line and candlestick.
class ToggleChartType extends ChartEvent {
  const ToggleChartType();
}

/// Change the chart time duration.
class ChangeDuration extends ChartEvent {
  final TimeDuration duration;

  const ChangeDuration(this.duration);

  @override
  List<Object?> get props => [duration];
}

// --- States ---

/// Base state for the ChartBLoC.
sealed class ChartState extends Equatable {
  const ChartState();

  @override
  List<Object?> get props => [];
}

/// Initial state before any chart data is requested.
class ChartInitial extends ChartState {
  const ChartInitial();
}

/// Chart data is currently being fetched.
class ChartLoading extends ChartState {
  final ChartType currentType;
  final TimeDuration duration;

  const ChartLoading({
    required this.currentType,
    required this.duration,
  });

  @override
  List<Object?> get props => [currentType, duration];
}

/// Chart data loaded successfully with at least 2 data points.
class ChartLoaded extends ChartState {
  final List<OhlcCandle> candles;
  final ChartType chartType;
  final TimeDuration duration;

  const ChartLoaded({
    required this.candles,
    required this.chartType,
    required this.duration,
  });

  @override
  List<Object?> get props => [candles, chartType, duration];
}

/// Chart data fetch failed.
class ChartError extends ChartState {
  final String message;
  final List<OhlcCandle>? previousData;
  final ChartType chartType;
  final TimeDuration duration;

  const ChartError({
    required this.message,
    this.previousData,
    required this.chartType,
    required this.duration,
  });

  @override
  List<Object?> get props => [message, previousData, chartType, duration];
}

/// Fewer than 2 data points available for the selected duration.
class InsufficientData extends ChartState {
  final ChartType chartType;
  final TimeDuration duration;

  const InsufficientData({
    required this.chartType,
    required this.duration,
  });

  @override
  List<Object?> get props => [chartType, duration];
}

// --- BLoC ---

/// Manages chart state including data loading, chart type toggling, and
/// duration changes.
class ChartBloc extends Bloc<ChartEvent, ChartState> {
  final MarketDataRepository _repository;

  ChartType _currentChartType = ChartType.line;
  TimeDuration _currentDuration = TimeDuration.twentyFourHour;
  String _currentSymbol = '';
  List<OhlcCandle>? _lastCandles;

  ChartBloc({required MarketDataRepository repository})
      : _repository = repository,
        super(const ChartInitial()) {
    on<LoadChart>(_onLoadChart);
    on<ToggleChartType>(_onToggleChartType);
    on<ChangeDuration>(_onChangeDuration);
  }

  /// Current chart type (line or candlestick).
  ChartType get currentChartType => _currentChartType;

  /// Current time duration selection.
  TimeDuration get currentDuration => _currentDuration;

  /// Current symbol being charted.
  String get currentSymbol => _currentSymbol;

  Future<void> _onLoadChart(LoadChart event, Emitter<ChartState> emit) async {
    _currentSymbol = event.symbol;

    emit(ChartLoading(
      currentType: _currentChartType,
      duration: _currentDuration,
    ));

    try {
      final candles = await _repository.getOhlcData(
        symbol: _currentSymbol,
        duration: _currentDuration,
      );

      if (candles.length < 2) {
        _lastCandles = null;
        emit(InsufficientData(
          chartType: _currentChartType,
          duration: _currentDuration,
        ));
      } else {
        _lastCandles = candles;
        emit(ChartLoaded(
          candles: candles,
          chartType: _currentChartType,
          duration: _currentDuration,
        ));
      }
    } catch (e) {
      emit(ChartError(
        message: e.toString(),
        previousData: _lastCandles,
        chartType: _currentChartType,
        duration: _currentDuration,
      ));
    }
  }

  void _onToggleChartType(ToggleChartType event, Emitter<ChartState> emit) {
    _currentChartType = _currentChartType == ChartType.line
        ? ChartType.candlestick
        : ChartType.line;

    final currentState = state;
    if (currentState is ChartLoaded) {
      emit(ChartLoaded(
        candles: currentState.candles,
        chartType: _currentChartType,
        duration: currentState.duration,
      ));
    } else if (currentState is ChartError) {
      emit(ChartError(
        message: currentState.message,
        previousData: currentState.previousData,
        chartType: _currentChartType,
        duration: currentState.duration,
      ));
    } else if (currentState is InsufficientData) {
      emit(InsufficientData(
        chartType: _currentChartType,
        duration: currentState.duration,
      ));
    } else if (currentState is ChartLoading) {
      emit(ChartLoading(
        currentType: _currentChartType,
        duration: currentState.duration,
      ));
    }
  }

  Future<void> _onChangeDuration(
    ChangeDuration event,
    Emitter<ChartState> emit,
  ) async {
    _currentDuration = event.duration;

    emit(ChartLoading(
      currentType: _currentChartType,
      duration: _currentDuration,
    ));

    if (_currentSymbol.isEmpty) return;

    try {
      final candles = await _repository.getOhlcData(
        symbol: _currentSymbol,
        duration: _currentDuration,
      );

      if (candles.length < 2) {
        _lastCandles = null;
        emit(InsufficientData(
          chartType: _currentChartType,
          duration: _currentDuration,
        ));
      } else {
        _lastCandles = candles;
        emit(ChartLoaded(
          candles: candles,
          chartType: _currentChartType,
          duration: _currentDuration,
        ));
      }
    } catch (e) {
      emit(ChartError(
        message: e.toString(),
        previousData: _lastCandles,
        chartType: _currentChartType,
        duration: _currentDuration,
      ));
    }
  }
}
