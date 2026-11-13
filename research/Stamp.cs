namespace StampDataModel
{
    public class Stamp
    {
        public int StampPath { get; set; }
        public int IconGUID { get; set; }
        public List<Building>? BuildingInfo { get; set; }
        public int? StreetCount { get; set; }
        public List<(int, List<StreetPoint>)>? StreetInfo { get; set; }
        public List<RailwaySegment>? RailwayInfos { get; set; }
    }

    public class Building
    {
        public float[] Pos { get; set; }
        public float Dir { get; set; }
        public int GUID { get; set; }
        public long? ComplexOwnerID { get; set; }
    }

    public class StreetPoint
    {
        public StreetPoint() { }

        public StreetPoint(float x, float y)
        {
            None = (x, y);
        }
        public (float, float) None { get; set; }
    }

    public class RailwaySegment
    { 
        public RailwaySegment() { }

        public RailwaySegment(int fromX, int fromY, int toX, int toY) 
        {
            None = (new int[2] { fromX, fromY }, new int[2] { toX, toY });
        }
        public (int[], int[]) None { get; set; }
    }

}