import pytest
import numpy as np
from app.core.keyframe import MotionKeyframeExtractor

def test_keyframe_extractor_initialization():
    extractor = MotionKeyframeExtractor(history_size=10, fallback_threshold=5.0)
    assert extractor.history_size == 10
    assert extractor.fallback_threshold == 5.0
    assert extractor.prev_frame is None
    assert len(extractor.diff_history) == 0

def test_first_frame_is_keyframe():
    extractor = MotionKeyframeExtractor()
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    is_keyframe, avg_diff, threshold = extractor.process_frame(frame)
    
    assert is_keyframe is True
    assert avg_diff == 0.0
    assert extractor.prev_frame is not None

def test_rolling_history_buffer():
    extractor = MotionKeyframeExtractor(history_size=5)
    
    # Send multiple distinct frames to fill buffer
    for i in range(10):
        # Create different solid frames
        frame = np.ones((100, 100, 3), dtype=np.uint8) * (i * 10)
        extractor.process_frame(frame)
        
    assert len(extractor.diff_history) == 5

def test_threshold_calculation():
    extractor = MotionKeyframeExtractor(history_size=10, fallback_threshold=10.0)
    
    # Feed frames with constant differences to trigger threshold calculation (>= 5 history values)
    # Differences will be constant
    for i in range(7):
        frame = np.ones((100, 100, 3), dtype=np.uint8) * (i * 20)
        is_keyframe, avg_diff, threshold = extractor.process_frame(frame)
        if i == 0:
            assert is_keyframe is True # first frame is always keyframe
        elif i < 6:
            # Under 5 elements in history before processing this frame, threshold should be fallback
            assert threshold == 10.0
        else:
            # At i = 6, history length is 5 (from i=1,2,3,4,5).
            # Mean is 20.0, std is 0.0, so threshold is 20.0 + 0.0 = 20.0.
            assert threshold == 20.0
