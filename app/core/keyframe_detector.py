import cv2
import numpy as np

class MotionKeyframeExtractor:
    def __init__(self, history_size=30, fallback_threshold=15.0):
        self.history_size = history_size
        self.fallback_threshold = fallback_threshold
        self.prev_frame = None
        self.diff_history = []

    def should_process_frame(self, current_frame):
        """
        Calculates pixel difference variance to discard redundant visual inputs.
        Reduces raw 30 FPS streams down to highly descriptive frame transformations.
        """
        gray = cv2.cvtColor(current_frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        if self.prev_frame is None:
            self.prev_frame = gray
            return True

        # Frame difference calculation
        frame_diff = cv2.absdiff(gray, self.prev_frame)
        avg_diff = np.mean(frame_diff)
        self.prev_frame = gray

        self.diff_history.append(avg_diff)
        if len(self.diff_history) > self.history_size:
            self.diff_history.pop(0)

        # Dynamic Threshold calculation based on paper metrics
        if len(self.diff_history) >= 5:
            mean_val = np.mean(self.diff_history)
            std_val = np.std(self.diff_history)
            threshold = mean_val + std_val
        else:
            threshold = self.fallback_threshold

        if avg_diff > threshold:
            return True
        return False
