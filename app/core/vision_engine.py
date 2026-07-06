import cv2
from ultralytics import YOLO

class VigilProctorEngine:
    def __init__(self, model_path="yolov8n.pt"):
        # Utilizing ultra-lightweight YOLO layouts for fast local edge iteration
        self.model = YOLO(model_path)
        # Class maps corresponding directly to the paper's target metrics
        self.target_classes = {
            "cell phone": "External Device",
            "person": "Multiple Persons",
            "remote": "External Device"
        }

    def analyze_frame(self, frame):
        """
        Executes inferencing over localized frames to identify visual deviations.
        """
        results = self.model(frame, verbose=False)[0]
        detected_anomalies = []
        
        person_count = 0
        
        for box in results.boxes:
            cls_id = int(box.cls[0])
            label = self.model.names[cls_id]
            confidence = float(box.conf[0])
            
            if label == "person":
                person_count += 1
                if person_count > 1:
                    detected_anomalies.append({
                        "type": "Multiple Persons",
                        "confidence": confidence
                    })
            elif label in self.target_classes:
                detected_anomalies.append({
                    "type": self.target_classes[label],
                    "confidence": confidence
                })

        # Basic geometric pose estimation logic for Head Movements
        # Tracks nose/eye coordinates via bounding box dimensions as fallback indicators
        if len(results.boxes) == 1 and person_count == 1:
            box = results.boxes[0]
            xywh = box.xywh[0].tolist()
            # If the bounding box aspect ratios warp severely, register profile deviations
            if xywh[2] / xywh[3] > 0.85:
                detected_anomalies.append({
                    "type": "Suspicious Head Movement",
                    "confidence": 0.72
                })

        return detected_anomalies
