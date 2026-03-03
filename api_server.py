import os
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
import mysql.connector
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from neo4j import GraphDatabase

# โหลดค่าจากไฟล์ .env
load_dotenv()

app = Flask(__name__)
# อนุญาต CORS ทุกกรณีเพื่อป้องกันปัญหาการเชื่อมต่อ
CORS(app)

# ==========================================
# 1. CONFIGURATION
# ==========================================

# Database MySQL
MYSQL_CONFIG = {
    'host': os.getenv('MYSQL_HOST', 'localhost'),
    'user': os.getenv('MYSQL_USER', 'root'),
    'password': os.getenv('MYSQL_PASSWORD', ''),      
    'database': os.getenv('MYSQL_DATABASE', 'cookies_db')
}

# Neo4j Aura Config (Cloud) 
NEO4J_URI = os.getenv('NEO4J_URI')
NEO4J_USER = os.getenv('NEO4J_USER')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')

# Initialize Neo4j Driver
driver = None
try:
    if NEO4J_URI and NEO4J_USER and NEO4J_PASSWORD:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        driver.verify_connectivity()
        print("[SYSTEM] Neo4j Aura Connected Successfully!")
    else:
        print("[ERROR] Neo4j Config is missing from .env file!")
except Exception as e:
    print(f"[ERROR] Neo4j Connection Failed: {e}")

# ==========================================
# 2. AI MODEL LOADING 
# ==========================================
print("[SYSTEM] Loading AI Models...")
HF_MODEL_DIR = './hf_cookie_model_balanced' 

try:
    # ใช้ AutoTokenizer และ SequenceClassification 
    tokenizer = AutoTokenizer.from_pretrained(HF_MODEL_DIR)
    model = AutoModelForSequenceClassification.from_pretrained(HF_MODEL_DIR)
    
    # ตรวจสอบว่าเครื่องมีการ์ดจอไหม ถ้าไม่มีให้ใช้ CPU 
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()
    
    # ดึง Label ออกมาจากสมองของโมเดลโดยตรง
    ID2LABEL = model.config.id2label
    print(f"[SYSTEM] AI Model (Balanced) Loaded Successfully on {device}!")

except Exception as e:
    print(f"[ERROR] Loading Model: {e}")
    ID2LABEL = {0: "Unknown"}

# ==========================================
# 3. NEO4J FUNCTION
# ==========================================

def push_to_neo4j(source_site, tracker_domain, label):
    if not tracker_domain: return
    if not source_site or source_site == "Unknown": source_site = "Unknown_Source"
    
    # แก้ชื่อ Extension ยาวๆ
    if len(source_site) == 32 and "." not in source_site:
        source_site = "Browser Extension"

    if source_site == tracker_domain: return

    print(f"[DEBUG] Graph Plotting: {source_site} -> {tracker_domain} ({label})")

    if driver:
        try:
            with driver.session() as session:
                query = """
                MERGE (s:Website {name: $site})
                MERGE (t:Tracker {name: $tracker})
                MERGE (s)-[r:SENDS_DATA_TO]->(t)
                SET r.type = $cookie_type, r.last_seen = datetime()
                """
                session.run(query, site=source_site, tracker=tracker_domain, cookie_type=label)    
            print(f"[SUCCESS] Graph Updated: {source_site} -> {tracker_domain}")
        except Exception as e:
            print(f"[ERROR] Neo4j Error: {e}")

# ==========================================
# 4. API ROUTES 
# ==========================================

@app.route('/', methods=['GET'])
def home():
    return "CookiesChecker API is Running with High Accuracy Model!"

# --- ซ่อน API History  ---
# @app.route('/history', methods=['GET'])
# def get_history():
#     try:
#         conn = mysql.connector.connect(**MYSQL_CONFIG)
#         cursor = conn.cursor(dictionary=True)
#         sql = "SELECT domain, GROUP_CONCAT(DISTINCT label SEPARATOR ', ') as labels FROM cookies GROUP BY domain ORDER BY MAX(id) DESC LIMIT 20"
#         cursor.execute(sql)
#         rows = cursor.fetchall()
#         conn.close()
#         return jsonify(rows)
#     except Exception as e:
#         return jsonify([])

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.json
        name = data.get('name', '')
        domain = data.get('domain', '')
        source_site = data.get('source_site', 'Unknown_Source') 

        conn = mysql.connector.connect(**MYSQL_CONFIG)
        cursor = conn.cursor(dictionary=True)
        
        # 1. เช็คใน Database ก่อนว่ามีไหม
        cursor.execute("SELECT label FROM cookies WHERE name=%s AND domain=%s LIMIT 1", (name, domain))
        result = cursor.fetchone()

        label = "Unknown"
        source = "ai_model"

        if result and result['label'] and result['label'] != 'Unknown':
            label = result['label']
            source = "database"
        else:
            # 2. ถ้าไม่มีใน Database ให้ AI ทำนาย
            try:
                text = f"{name} | {domain}"
                
                # แปลงข้อความเป็นตัวเลข
                inputs = tokenizer(
                    text, 
                    return_tensors="pt", 
                    truncation=True, 
                    padding=True, 
                    max_length=64
                ).to(device)
                
                # ให้ AI ทำนาย
                with torch.no_grad():
                    outputs = model(
                        input_ids=inputs["input_ids"], 
                        attention_mask=inputs["attention_mask"]
                    )
                    pred_id = torch.argmax(outputs.logits, dim=-1).item()
                    label = ID2LABEL[pred_id]
                    
                    print(f"[SUCCESS] AI Predicted: {name} => {label}")
                    
            except Exception as e:
                print(f"[ERROR] AI Prediction Failed: {e}")
                label = "Unknown"

            # บันทึกสิ่งที่ทำนายลง Database
            sql = "INSERT INTO cookies (name, domain, label, label_source) VALUES (%s, %s, %s, 'ai_predicted') ON DUPLICATE KEY UPDATE label=%s"
            cursor.execute(sql, (name, domain, label, label))
            conn.commit()
        
        conn.close()

        # Send to Neo4j
        push_to_neo4j(source_site, domain, label)

        return jsonify({"source": source, "label": label})

    except Exception as e:
        print(f"[ERROR] Server Error: {e}")
        return jsonify({"source": "error", "label": "Unknown"})

@app.route('/graph-data', methods=['GET'])
def get_graph_data():
    target_site = request.args.get('site')
    nodes = []
    edges = []
    node_ids = set()

    try:
        if driver:
            with driver.session() as session:
                if target_site:
                    query = """
                    MATCH (s:Website {name: $site})-[r1]->(m)
                    OPTIONAL MATCH (m)-[r2]->(p)
                    RETURN s, r1, m, r2, p
                    """
                    result = session.run(query, site=target_site)
                else:
                    query = "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 100"
                    result = session.run(query)

                for record in result:
                    items = [('n', 'r', 'm')] if not target_site else [('s', 'r1', 'm'), ('m', 'r2', 'p')]
                    for n_key, r_key, m_key in items:
                        n = record.get(n_key)
                        m = record.get(m_key)
                        r = record.get(r_key)

                        if n and n.element_id not in node_ids:
                            nodes.append({
                                "id": n.element_id,
                                "label": n.get("name", "Unknown"),
                                "group": "website" if "Website" in n.labels else "tracker"
                            })
                            node_ids.add(n.element_id)

                        if m and m.element_id not in node_ids:
                            nodes.append({
                                "id": m.element_id,
                                "label": m.get("name", "Unknown"),
                                "group": "website" if "Website" in m.labels else "tracker"
                            })
                            node_ids.add(m.element_id)

                        if n and m and r:
                            edges.append({
                                "from": n.element_id,
                                "to": m.element_id,
                                "label": r.get("type", "LINK"),
                                "arrows": "to"
                            })

        return jsonify({"nodes": nodes, "edges": edges})
    except Exception as e:
        print(f"[ERROR] Graph Query Failed: {e}")
        return jsonify({"nodes": [], "edges": []})

if __name__ == '__main__':
    try:
        print("Starting CookiesChecker Server...")
        app.run(host='0.0.0.0', port=5000, threaded=True)
    finally:
        if driver:
            driver.close()